/**
 * Lightweight Meteor DDP Client for Browser Extensions
 *
 * Based on DDP protocol specification:
 * https://github.com/meteor/meteor/blob/devel/packages/ddp/DDP.md
 *
 * This client implements core DDP functionality:
 * - WebSocket connection with version negotiation
 * - Method calls (RPC)
 * - Authentication
 * - Heartbeat/ping-pong
 */

class MeteorDDPClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.sessionId = null;
    this.connected = false;
    this.nextId = 1;
    this.pendingMethods = new Map(); // id -> { resolve, reject }
    this.subscriptions = new Map(); // id -> { name, params, resolve, reject }
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    // Event handlers
    this.onConnected = null;
    this.onDisconnected = null;
    this.onError = null;
  }

  /**
   * Connect to DiceCloud Meteor server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      // Use WebSocket directly (DiceCloud supports WebSockets)
      const wsUrl = this.url.replace('https://', 'wss://').replace('http://', 'ws://');

      console.log('[DDP] Connecting to:', wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[DDP] WebSocket opened');
        // Send connect message with DDP version negotiation
        this.send({
          msg: 'connect',
          version: '1',
          support: ['1', 'pre2', 'pre1']
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);

          // Resolve connection promise when connected
          if (message.msg === 'connected' && !this.connected) {
            this.connected = true;
            this.sessionId = message.session;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            console.log('[DDP] Connected with session:', this.sessionId);
            if (this.onConnected) this.onConnected();
            resolve(this.sessionId);
          }
        } catch (error) {
          console.error('[DDP] Failed to parse message:', error);
          if (this.onError) this.onError(error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[DDP] WebSocket error:', error);
        if (this.onError) this.onError(error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[DDP] WebSocket closed');
        this.connected = false;
        this.stopHeartbeat();
        if (this.onDisconnected) this.onDisconnected();

        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`[DDP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect(), delay);
        }
      };
    });
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.sessionId = null;
  }

  /**
   * Send a message to the server
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[DDP] Cannot send message - WebSocket not open');
      return false;
    }

    const json = JSON.stringify(message);
    // Only log non-heartbeat messages to reduce console spam
    if (message.msg !== 'ping' && message.msg !== 'pong') {
      console.log('[DDP] Sending:', message.msg, message);
    }
    this.ws.send(json);
    return true;
  }

  /**
   * Handle incoming messages from server
   */
  handleMessage(message) {
    // Only log non-heartbeat messages to reduce console spam
    if (message.msg !== 'ping' && message.msg !== 'pong') {
      console.log('[DDP] Received:', message.msg, message);
    }

    switch (message.msg) {
      case 'connected':
        // Handled in onmessage
        break;

      case 'failed':
        console.error('[DDP] Connection failed:', message);
        break;

      case 'ping':
        // Respond to server heartbeat
        this.send({ msg: 'pong', id: message.id });
        break;

      case 'pong':
        // Server responded to our heartbeat
        break;

      case 'result':
        // Method call result
        this.handleMethodResult(message);
        break;

      case 'updated':
        // Method writes have been reflected
        console.log('[DDP] Methods updated:', message.methods);
        break;

      case 'ready':
        // Subscription is ready
        this.handleSubscriptionReady(message);
        break;

      case 'nosub':
        // Subscription failed
        this.handleSubscriptionError(message);
        break;

      case 'added':
      case 'changed':
      case 'removed':
        // Collection updates (we don't need these for method calls)
        break;

      case 'error':
        console.error('[DDP] Protocol error:', message);
        break;

      default:
        console.warn('[DDP] Unknown message type:', message.msg);
    }
  }

  /**
   * Handle method call result
   */
  handleMethodResult(message) {
    const { id, error, result } = message;
    const pending = this.pendingMethods.get(id);

    if (!pending) {
      console.warn('[DDP] Received result for unknown method:', id);
      return;
    }

    this.pendingMethods.delete(id);

    if (error) {
      console.error('[DDP] Method error:', error);
      pending.reject(new Error(error.message || error.reason || 'Method call failed'));
    } else {
      console.log('[DDP] Method result:', result);
      pending.resolve(result);
    }
  }

  /**
   * Handle subscription ready
   */
  handleSubscriptionReady(message) {
    const { subs } = message;

    for (const id of subs) {
      const sub = this.subscriptions.get(id);
      if (sub && sub.resolve) {
        sub.resolve();
      }
    }
  }

  /**
   * Handle subscription error
   */
  handleSubscriptionError(message) {
    const { id, error } = message;
    const sub = this.subscriptions.get(id);

    if (sub && sub.reject) {
      sub.reject(new Error(error?.message || 'Subscription failed'));
    }

    this.subscriptions.delete(id);
  }

  /**
   * Call a Meteor method
   */
  async call(methodName, ...params) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    const id = String(this.nextId++);

    return new Promise((resolve, reject) => {
      this.pendingMethods.set(id, { resolve, reject });

      this.send({
        msg: 'method',
        method: methodName,
        params: params,
        id: id
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMethods.has(id)) {
          this.pendingMethods.delete(id);
          reject(new Error(`Method call timeout: ${methodName}`));
        }
      }, 30000);
    });
  }

  /**
   * Subscribe to a publication
   */
  async subscribe(name, ...params) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    const id = String(this.nextId++);

    return new Promise((resolve, reject) => {
      this.subscriptions.set(id, { name, params, resolve, reject });

      this.send({
        msg: 'sub',
        id: id,
        name: name,
        params: params
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.subscriptions.has(id)) {
          const sub = this.subscriptions.get(id);
          this.subscriptions.delete(id);
          reject(new Error(`Subscription timeout: ${name}`));
        }
      }, 30000);
    });
  }

  /**
   * Unsubscribe from a publication
   */
  unsubscribe(subscriptionId) {
    this.send({
      msg: 'unsub',
      id: subscriptionId
    });
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Login with token (resume token from API)
   */
  async loginWithToken(token) {
    try {
      const result = await this.call('login', {
        resume: token
      });
      console.log('[DDP] Logged in:', result);
      return result;
    } catch (error) {
      console.error('[DDP] Login failed:', error);
      throw error;
    }
  }

  /**
   * Start heartbeat ping-pong
   */
  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        const pingId = String(this.nextId++);
        this.send({
          msg: 'ping',
          id: pingId
        });
      }
    }, 25000); // Ping every 25 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeteorDDPClient;
}

// Export for browser extension
window.DDPClient = MeteorDDPClient;
