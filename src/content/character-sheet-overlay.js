/**
 * Custom Character Sheet Overlay for Roll20
 * Displays Dice Cloud character data in a beautiful, interactive overlay
 */

(function() {
  'use strict';

  debug.log('🎲 RollCloud: Custom sheet overlay loaded');

  let characterData = null;
  let overlayVisible = false;
  let overlayElement = null;
  let activePopupWindow = null; // Track the currently open popup to ensure only one at a time

  // Roll statistics and history
  const rollStats = {
    history: [],
    settings: {
      enabled: true,
      showNotifications: true,
      showHistory: true,
      maxHistorySize: 20,
      advantageMode: 'normal' // 'normal', 'advantage', 'disadvantage'
    },
    stats: {
      totalRolls: 0,
      averageRoll: 0,
      highestRoll: 0,
      lowestRoll: Infinity,
      criticalSuccesses: 0,
      criticalFailures: 0
    }
  };

  /**
   * Utility function to position popup within viewport bounds
   * Cached viewport dimensions to avoid forced reflows
   * @param {number} x - Initial X position (clientX)
   * @param {number} y - Initial Y position (clientY)
   * @param {number} width - Popup width (default: 200)
   * @param {number} height - Popup height (default: 150)
   * @returns {Object} - Adjusted x, y coordinates within viewport
   */
  const viewportCache = { width: 0, height: 0, lastUpdate: 0 };
  function getPopupPosition(x, y, width = 200, height = 150) {
    // Cache viewport dimensions for 100ms to avoid repeated layout reads
    const now = Date.now();
    if (now - viewportCache.lastUpdate > 100) {
      viewportCache.width = window.innerWidth;
      viewportCache.height = window.innerHeight;
      viewportCache.lastUpdate = now;
    }

    const viewportWidth = viewportCache.width;
    const viewportHeight = viewportCache.height;

    // Adjust horizontal position
    let adjustedX = x;
    if (x + width > viewportWidth) {
      adjustedX = viewportWidth - width - 10; // 10px margin from edge
      if (adjustedX < 10) adjustedX = 10; // Ensure minimum margin from left edge
    }

    // Adjust vertical position
    let adjustedY = y;
    if (y + height > viewportHeight) {
      adjustedY = viewportHeight - height - 10; // 10px margin from edge
      if (adjustedY < 10) adjustedY = 10; // Ensure minimum margin from top edge
    }

    return { x: adjustedX, y: adjustedY };
  }

  /**
   * Creates the custom character sheet overlay
   */
  function createOverlay() {
    if (overlayElement) return;

    overlayElement = document.createElement('div');
    overlayElement.id = 'rollcloud-character-overlay';
    overlayElement.innerHTML = `
      <div class="rollcloud-sheet-container">
        <div class="rollcloud-header">
          <div class="sheet-title">
            <h2 id="character-name">Character Name</h2>
            <div class="character-subtitle">
              <span id="character-class">Class</span> 
              <span id="character-level">Level 1</span> • 
              <span id="character-race">Race</span>
            </div>
          </div>
          <div class="sheet-controls">
            <button class="control-btn" id="popout-btn">🔗 Pop Out</button>
            <button class="control-btn" id="sync-btn">🔄 Sync Data</button>
            <button class="control-btn" id="close-btn">✕ Close</button>
          </div>
        </div>

        <div class="rollcloud-content">
          <!-- Abilities -->
          <div class="section">
            <h3>⚡ Abilities</h3>
            <div class="abilities-grid">
              <div class="ability-card" data-roll="1d20+0" data-name="Strength Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">STR</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
              <div class="ability-card" data-roll="1d20+0" data-name="Dexterity Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">DEX</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
              <div class="ability-card" data-roll="1d20+0" data-name="Constitution Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">CON</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
              <div class="ability-card" data-roll="1d20+0" data-name="Intelligence Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">INT</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
              <div class="ability-card" data-roll="1d20+0" data-name="Wisdom Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">WIS</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
              <div class="ability-card" data-roll="1d20+0" data-name="Charisma Check">
                <div class="roll-indicator">🎲</div>
                <div class="ability-name">CHA</div>
                <div class="ability-score">10</div>
                <div class="ability-mod">+0</div>
              </div>
            </div>
          </div>

          <!-- Combat Stats -->
          <div class="section">
            <h3>⚔️ Combat</h3>
            <div class="combat-stats">
              <div class="combat-stat">
                <label>Armor Class</label>
                <div class="value" id="ac">10</div>
              </div>
              <div class="combat-stat">
                <label>Hit Points</label>
                <div class="hp-input-group">
                  <input type="number" id="hp-current" class="hp-input" value="10" min="0">
                  <span class="hp-separator">/</span>
                  <input type="number" id="hp-max" class="hp-input" value="10" min="0">
                </div>
              </div>
              <div class="combat-stat">
                <label>Speed</label>
                <div class="value" id="speed">30</div>
              </div>
              <div class="combat-stat">
                <label>Initiative</label>
                <button class="initiative-btn" id="initiative-btn">+0</button>
              </div>
              <div class="combat-stat">
                <label>Proficiency</label>
                <div class="value" id="proficiency">+2</div>
              </div>
            </div>
          </div>

          <!-- Saving Throws -->
          <div class="section">
            <h3>🛡️ Saving Throws</h3>
            <div class="saves-grid">
              <div class="save-card">
                <span class="save-name">STR</span>
                <span class="save-bonus" id="strength-save">+0</span>
              </div>
              <div class="save-card">
                <span class="save-name">DEX</span>
                <span class="save-bonus" id="dexterity-save">+0</span>
              </div>
              <div class="save-card">
                <span class="save-name">CON</span>
                <span class="save-bonus" id="constitution-save">+0</span>
              </div>
              <div class="save-card">
                <span class="save-name">INT</span>
                <span class="save-bonus" id="intelligence-save">+0</span>
              </div>
              <div class="save-card">
                <span class="save-name">WIS</span>
                <span class="save-bonus" id="wisdom-save">+0</span>
              </div>
              <div class="save-card">
                <span class="save-name">CHA</span>
                <span class="save-bonus" id="charisma-save">+0</span>
              </div>
            </div>
          </div>

          <!-- Skills -->
          <div class="section">
            <h3> Skills</h3>
            <div class="skills-grid">
              <div class="skill-card">
                <span class="skill-name">Acrobatics</span>
                <span class="skill-bonus" id="acrobatics">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Animal Handling</span>
                <span class="skill-bonus" id="animal-handling">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Arcana</span>
                <span class="skill-bonus" id="arcana">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Athletics</span>
                <span class="skill-bonus" id="athletics">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Deception</span>
                <span class="skill-bonus" id="deception">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">History</span>
                <span class="skill-bonus" id="history">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Insight</span>
                <span class="skill-bonus" id="insight">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Intimidation</span>
                <span class="skill-bonus" id="intimidation">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Investigation</span>
                <span class="skill-bonus" id="investigation">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Medicine</span>
                <span class="skill-bonus" id="medicine">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Nature</span>
                <span class="skill-bonus" id="nature">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Perception</span>
                <span class="skill-bonus" id="perception">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Performance</span>
                <span class="skill-bonus" id="performance">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Persuasion</span>
                <span class="skill-bonus" id="persuasion">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Religion</span>
                <span class="skill-bonus" id="religion">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Sleight of Hand</span>
                <span class="skill-bonus" id="sleight-of-hand">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Stealth</span>
                <span class="skill-bonus" id="stealth">+0</span>
              </div>
              <div class="skill-card">
                <span class="skill-name">Survival</span>
                <span class="skill-bonus" id="survival">+0</span>
              </div>
            </div>
          </div>

          <!-- Resources (Vexus Fields) -->
          <div class="section">
            <h3>🔮 Resources</h3>
            <div class="resources-grid">
              <div class="resource-card">
                <label>Level 1 Slots</label>
                <div class="value" id="level1-slots">0</div>
              </div>
              <div class="resource-card">
                <label>Level 2 Slots</label>
                <div class="value" id="level2-slots">0</div>
              </div>
              <div class="resource-card">
                <label>Level 3 Slots</label>
                <div class="value" id="level3-slots">0</div>
              </div>
              <div class="resource-card">
                <label>Ki Points</label>
                <div class="value" id="ki">0</div>
              </div>
              <div class="resource-card">
                <label>Sorcery Points</label>
                <div class="value" id="sorcery-points">0</div>
              </div>
              <div class="resource-card">
                <label>Rages</label>
                <div class="value" id="rages">0</div>
              </div>
            </div>
          </div>

          <!-- Additional Variables -->
          <div class="section" id="additional-variables">
            <h3>📊 Additional Variables</h3>
            <div id="variables-grid">
              <!-- Dynamic content will be added here -->
            </div>
          </div>

          <!-- Spells -->
          <div class="section spells-section">
            <h3>🔮 Spells</h3>
            <div class="spells-grid" id="spells-grid">
              <div class="empty-state">No spells available</div>
            </div>
          </div>

          <!-- Spell Slots -->
          <div class="section spell-slots-section">
            <h3>✨ Spell Slots</h3>
            <div class="spell-slots-grid" id="spell-slots-grid">
              <div class="empty-state">No spell slots available</div>
            </div>
          </div>

          <!-- Dice Cloud Panels -->
          <div class="dicecloud-panels">
            <!-- Roll History Panel -->
            <div class="panel-section" id="roll-history-panel">
              <div class="panel-header">
                <span class="panel-title">🎲 Roll History</span>
                <button class="panel-toggle" id="history-toggle">−</button>
              </div>
              <div class="panel-content">
                <div class="history-list" id="roll-history-list">
                  <div class="empty-state">No rolls yet. Make some rolls!</div>
                </div>
              </div>
            </div>

            <!-- Statistics Panel -->
            <div class="panel-section" id="stats-panel">
              <div class="panel-header">
                <span class="panel-title">📊 Statistics</span>
                <button class="panel-toggle" id="stats-toggle">−</button>
              </div>
              <div class="panel-content">
                <div class="stats-grid">
                  <div class="stat-item">
                    <span class="stat-label">Total Rolls</span>
                    <span class="stat-value" id="stat-total">0</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Average</span>
                    <span class="stat-value" id="stat-average">0.0</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Highest</span>
                    <span class="stat-value" id="stat-highest">0</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Lowest</span>
                    <span class="stat-value" id="stat-lowest">∞</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">⭐ Critical Hits</span>
                    <span class="stat-value" id="stat-crits">0</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">💀 Critical Fails</span>
                    <span class="stat-value" id="stat-fails">0</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Settings Panel -->
            <div class="panel-section" id="settings-panel">
              <div class="panel-header">
                <span class="panel-title">⚙️ Roll Settings</span>
                <button class="panel-toggle" id="settings-toggle">−</button>
              </div>
              <div class="panel-content">
                <div class="setting-group">
                  <label class="setting-label">Roll Mode</label>
                  <div class="toggle-buttons">
                    <button class="toggle-btn active" data-mode="normal">Normal</button>
                    <button class="toggle-btn" data-mode="advantage">Advantage</button>
                    <button class="toggle-btn" data-mode="disadvantage">Disadvantage</button>
                  </div>
                </div>
                <div class="setting-description">
                  Choose how d20 rolls are calculated when forwarded to Roll20
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #rollcloud-character-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(5px);
        z-index: 999999;
        display: none;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .rollcloud-sheet-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90%;
        max-width: 1200px;
        max-height: 90vh;
        background: #1a1a1a;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 2px solid #FC57F9;
      }

      .rollcloud-header {
        background: #3d0638;
        color: white;
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2px solid #FC57F9;
      }

      .sheet-title h2 {
        margin: 0 0 5px 0;
        font-size: 1.8em;
      }

      .character-subtitle {
        font-size: 1.1em;
        opacity: 0.9;
      }

      .sheet-controls {
        display: flex;
        gap: 10px;
      }

      .control-btn {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        transition: background 0.2s;
      }

      .control-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .rollcloud-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      }

      .section {
        margin-bottom: 25px;
      }

      .section h3 {
        margin: 0 0 15px 0;
        color: #e0e0e0;
        border-bottom: 2px solid #FC57F9;
        padding-bottom: 5px;
      }

      .abilities-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
      }

      .ability-card {
        background: #3d0638;
        padding: 15px;
        border-radius: 12px;
        text-align: center;
        border: 2px solid #FC57F9;
        transition: transform 0.2s;
        position: relative;
        cursor: pointer;
      }

      .ability-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
      }

      .ability-card:active {
        transform: translateY(0);
      }

      .roll-indicator {
        position: absolute;
        top: 5px;
        right: 5px;
        background: #FC57F9;
        color: white;
        border: none;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 10px rgba(0, 255, 65, 0.3);
        pointer-events: none;
      }

      .skill-roll-btn {
        background: #FC57F9;
        color: white;
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .skill-roll-btn:hover {
        background: #8E0682;
      }

      .ability-name {
        font-weight: bold;
        color: #e0e0e0;
        font-size: 0.9em;
        margin-bottom: 5px;
      }

      .ability-score {
        font-size: 2em;
        font-weight: bold;
        color: #FC57F9;
        line-height: 1;
      }

      .ability-mod {
        color: #FC57F9;
        font-weight: bold;
      }

      .combat-stats, .resources-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
      }

      .combat-stat, .resource-card {
        background: #3d0638;
        padding: 15px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid #FC57F9;
      }

      .combat-stat label, .resource-card label {
        display: block;
        font-weight: bold;
        color: #e0e0e0;
        margin-bottom: 8px;
        font-size: 0.9em;
      }

      .combat-stat .value, .resource-card .value {
        font-size: 1.4em;
        font-weight: bold;
        color: #FC57F9;
      }

      .hp-input-group {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .hp-input {
        width: 50px;
        text-align: center;
        font-size: 1.2em;
        font-weight: bold;
        color: #FC57F9;
        background: #1a1a1a;
        border: 2px solid #FC57F9;
        border-radius: 4px;
        padding: 4px;
      }

      .hp-separator {
        font-weight: bold;
        color: #FC57F9;
        font-size: 1.2em;
      }

      .initiative-btn {
        background: #FC57F9;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 1.2em;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .initiative-btn:hover {
        background: #8E0682;
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(78, 205, 196, 0.3);
      }

      .saves-grid, .skills-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
      }

      .save-card, .skill-card {
        background: #3d0638;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #FC57F9;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .save-card:hover, .skill-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
      }

      .save-name, .skill-name {
        font-weight: bold;
        color: #e0e0e0;
      }

      .save-bonus, .skill-bonus {
        font-weight: bold;
        color: #FC57F9;
        background: #1a1a1a;
        padding: 2px 8px;
        border-radius: 12px;
        border: 1px solid #FC57F9;
      }

      #variables-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
      }

      .variable-card {
        background: #3d0638;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #FC57F9;
      }

      .variable-name {
        font-weight: bold;
        color: #e0e0e0;
        font-size: 0.9em;
      }

      .variable-value {
        color: #FC57F9;
        font-weight: bold;
      }

      /* Dice Cloud Panels */
      .dicecloud-panels {
        display: grid;
        grid-template-columns: 1fr;
        gap: 20px;
        margin-top: 20px;
      }

      .panel-section {
        background: #3d0638;
        border-radius: 12px;
        border: 1px solid #FC57F9;
        overflow: hidden;
      }

      .panel-header {
        background: #3d0638;
        color: white;
        padding: 15px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
      }

      .panel-title {
        font-weight: bold;
        font-size: 1.1em;
      }

      .panel-toggle {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: background 0.2s;
      }

      .panel-toggle:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .panel-content {
        padding: 20px;
      }

      .history-list {
        max-height: 300px;
        overflow-y: auto;
      }

      .history-item {
        background: #1a1a1a;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 8px;
        border: 1px solid #FC57F9;
        animation: slideIn 0.3s ease-out;
      }

      .history-item-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 5px;
      }

      .history-name {
        font-weight: bold;
        color: #e0e0e0;
      }

      .history-time {
        color: #6c757d;
        font-size: 0.9em;
      }

      .history-formula {
        font-family: 'Courier New', monospace;
        color: #FC57F9;
        font-weight: bold;
      }

      .history-badges {
        margin-top: 5px;
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }

      .history-badge {
        background: #e9ecef;
        color: #495057;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.8em;
        font-weight: bold;
      }

      .critical-success {
        background: #d4edda;
        color: #155724;
      }

      .critical-failure {
        background: #f8d7da;
        color: #721c24;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
      }

      .stat-item {
        background: #1a1a1a;
        padding: 15px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid #dee2e6;
      }

      .stat-label {
        display: block;
        font-weight: bold;
        color: #6c757d;
        font-size: 0.9em;
        margin-bottom: 8px;
      }

      .stat-value {
        font-size: 1.5em;
        font-weight: bold;
        color: #FC57F9;
      }

      .setting-group {
        margin-bottom: 20px;
      }

      .setting-label {
        display: block;
        font-weight: bold;
        color: #495057;
        margin-bottom: 10px;
      }

      .toggle-buttons {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .toggle-btn {
        background: #e9ecef;
        border: 2px solid #dee2e6;
        color: #495057;
        padding: 12px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
        text-align: center;
      }

      .toggle-btn:hover {
        background: #f8f9fa;
        border-color: #adb5bd;
        transform: translateY(-1px);
      }

      .toggle-btn.active {
        background: #3d0638;
        border-color: #FC57F9;
        color: white;
        box-shadow: 0 2px 8px rgba(78, 205, 196, 0.3);
      }

      .setting-description {
        background: rgba(78, 205, 196, 0.1);
        padding: 12px;
        border-radius: 8px;
        font-size: 0.9em;
        color: #e0e0e0;
        text-align: center;
        margin-top: 10px;
        border: 1px solid #FC57F9;
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: #6c757d;
        font-style: italic;
      }

      /* Spells Section */
      .spells-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
      }

      .spell-card {
        background: linear-gradient(135deg, #f8f9ff 0%, #e8f0ff 100%);
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #FC57F9;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .spell-card.spell-attack:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        border-color: #e74c3c;
      }

      .spell-card.spell-utility:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        border-color: #3498db;
      }

      .spell-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .spell-name {
        font-weight: bold;
        color: #e0e0e0;
      }

      .spell-action {
        font-size: 16px;
        opacity: 0.8;
      }

      .spell-details {
        display: flex;
        gap: 8px;
        margin-bottom: 4px;
      }

      .spell-level, .spell-school {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        background: #FC57F9;
        color: white;
      }

      .spell-casting-time {
        font-size: 11px;
        color: #7f8c8d;
        font-style: italic;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-10px);
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes fadeOut {
        from {
          opacity: 1;
        }
        to {
          opacity: 0;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlayElement);

    // Add event listeners
    const closeBtn = document.getElementById('close-btn');
    const popoutBtn = document.getElementById('popout-btn');
    const syncBtn = document.getElementById('sync-btn');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        debug.log('🔴 Close button clicked');
        hideOverlay();
      });
    } else {
      debug.error('❌ Close button not found');
    }
    
    if (popoutBtn) {
      popoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        debug.log('🔗 Pop out button clicked');
        popOutCharacterSheet();
      });
    } else {
      debug.error('❌ Pop out button not found');
    }
    
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        debug.log('🔄 Manual sync triggered from character sheet');
        
        // Show loading state
        const originalText = syncBtn.innerHTML;
        syncBtn.innerHTML = '🔄 Syncing...';
        syncBtn.disabled = true;
        
        // Reload character data from extension storage
        loadCharacterData();
        
        // Reset button after a delay
        setTimeout(() => {
          syncBtn.innerHTML = originalText;
          syncBtn.disabled = false;
        }, 2000);
      });
    } else {
      debug.error('❌ Sync button not found');
    }

    // Add panel event listeners
    document.getElementById('history-toggle').addEventListener('click', () => togglePanel('history'));
    document.getElementById('stats-toggle').addEventListener('click', () => togglePanel('stats'));
    document.getElementById('settings-toggle').addEventListener('click', () => togglePanel('settings'));

    // Note: Dragging is not needed as overlay is shown in popup window
  }

  /**
   * Opens the character sheet in a popup window
   */
  function popOutCharacterSheet() {
    debug.log('🔗 Opening character sheet in popup...');
    showOverlay();
  }

  /**
   * Loads character data from extension storage
   * Opera-compatible with timeout, retry logic, and direct storage fallback
   */
  async function loadCharacterData() {
    debug.log('📋 Loading character data from storage...');

    // Create a timeout to handle unresponsive background scripts (Opera issue)
    let timeoutId;
    let messageHandled = false;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!messageHandled) {
          reject(new Error('Background script timeout - service worker may be inactive'));
        }
      }, 3000); // 3 second timeout (reduced for faster fallback)
    });

    // Try to send message with Promise wrapper for better error handling
    const messagePromise = new Promise((resolve, reject) => {
      try {
        browserAPI.runtime.sendMessage({ action: 'getCharacterData' }, (response) => {
          messageHandled = true;
          clearTimeout(timeoutId);

          if (browserAPI.runtime.lastError) {
            debug.error('📋 Extension context error:', browserAPI.runtime.lastError);
            reject(new Error(browserAPI.runtime.lastError.message || 'Extension context error'));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        messageHandled = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    try {
      // Race between message and timeout
      const response = await Promise.race([messagePromise, timeoutPromise]);

      if (response && response.data) {
        debug.log('📋 Character data loaded via background script:', response.data.name);
        characterData = response.data;
        showNotification('Character data synced! ✅', 'success');

        // Add roll event listeners after character data is loaded
        addRollEventListeners();
        return;
      } else {
        debug.log('📋 No character data found');
        showNotification('No character data found. Please sync from Dice Cloud first.', 'error');
        return;
      }
    } catch (error) {
      debug.warn('📋 Background script unavailable:', error.message);
      debug.log('📋 Attempting direct storage access fallback...');

      // FALLBACK: Access storage directly (Opera compatibility when service worker is asleep)
      try {
        const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId']);
        const characterProfiles = result.characterProfiles || {};
        const activeCharacterId = result.activeCharacterId;

        if (activeCharacterId && characterProfiles[activeCharacterId]) {
          const activeChar = characterProfiles[activeCharacterId];
          characterData = activeChar.character || activeChar;

          debug.log('📋 Character data loaded via direct storage:', characterData.name);
          showNotification('Character data synced! ✅', 'success');

          // Add roll event listeners after character data is loaded
          addRollEventListeners();
        } else {
          debug.log('📋 No character data found in direct storage');
          showNotification('No character data found. Please sync from Dice Cloud first.', 'error');
        }
      } catch (storageError) {
        debug.error('📋 Direct storage access failed:', storageError);
        showNotification('Failed to load character data. Try refreshing the page.', 'error');

        // Last resort: try to wake service worker
        debug.log('📋 Attempting to wake service worker...');
        try {
          browserAPI.runtime.sendMessage({ action: 'ping' });
        } catch (e) {
          debug.error('📋 Failed to ping service worker:', e);
        }
      }
    }
  }

  /**
   * Posts spell description to Roll20 chat
   */
  function postSpellDescriptionToChat(spellName, spellLevel, spellDescription) {
    debug.log('🔮 Posting spell description to chat:', spellName);

    const message = `/em casts **${spellName}** (Level ${spellLevel})\n${spellDescription || 'No description available'}`;

    const success = postChatMessage(message);
    if (success) {
      showNotification(`${spellName} description posted to chat! ✨`, 'success');
    } else {
      showNotification('Failed to post to chat. Make sure you are on Roll20.', 'error');
    }
  }

  /**
   * Adds roll event listeners to all rollable elements
   */
  function addRollEventListeners() {
    // Add roll button listeners
    document.querySelectorAll('.ability-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const roll = card.getAttribute('data-roll');
        const name = card.getAttribute('data-name');
        debug.log(` Clicked ability card: ${name} (${roll})`);
        
        // Make announcement in Roll20 chat first
        const characterName = characterData?.name || 'Character';
        const announcement = `&{template:default} {{name=${characterName} - ${name}}} {{description=Ability Check}}`;
        postChatMessage(announcement);
        
        // Then roll the dice
        setTimeout(() => rollSimultaneously(name, roll), 100);
      });
    });

    // Add spell card listeners
    document.querySelectorAll('.spell-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        debug.log(' Spell card clicked, checking data attributes...');
        
        const spellName = card.getAttribute('data-spell');
        const spellLevel = card.getAttribute('data-spell-level');
        const spellDescription = card.getAttribute('data-spell-description');
        const spellSchool = card.getAttribute('data-spell-school');
        const spellCastingTime = card.getAttribute('data-spell-casting-time');
        const spellRange = card.getAttribute('data-spell-range');
        const spellDuration = card.getAttribute('data-spell-duration');
        const spellComponents = card.getAttribute('data-spell-components');
        const clickAction = card.getAttribute('data-click-action');
        const castLevel = card.getAttribute('data-cast-level') || spellLevel;
        
        debug.log(` Clicked spell: ${spellName} (Level ${spellLevel}) - Action: ${clickAction}`);
        debug.log(' Spell description:', spellDescription);
        
        // Make detailed spell announcement in Roll20 chat
        const characterName = characterData?.name || 'Character';
        let announcement = `&{template:default} {{name= ${characterName} casts ${spellName}!}}`;
        
        // Add spell level and school information
        if (spellLevel > 0) {
          let levelText = castLevel > spellLevel
            ? `Level ${castLevel} (upcast from ${spellLevel})`
            : `Level ${spellLevel}`;
          if (spellSchool) levelText += ` ${spellSchool}`;
          announcement += ` {{Level=${levelText}}}`;
        } else if (spellSchool) {
          announcement += ` {{Level=${spellSchool} cantrip}}`;
        }
        
        // Add casting details
        if (spellCastingTime) announcement += ` {{Casting Time=${spellCastingTime}}}`;
        if (spellRange) announcement += ` {{Range=${spellRange}}}`;
        if (spellDuration) announcement += ` {{Duration=${spellDuration}}}`;
        if (spellComponents) announcement += ` {{Components=${spellComponents}}}`;
        
        // Add description if available
        if (spellDescription) {
          // Truncate description if too long for Roll20 template
          const truncatedDesc = spellDescription.length > 300 
            ? spellDescription.substring(0, 297) + '...' 
            : spellDescription;
          announcement += ` {{Description=${truncatedDesc}}}`;
        }
        
        debug.log(' Posting detailed spell announcement to chat');
        postChatMessage(announcement);
        
        // Then roll if it's an attack spell
        if (clickAction === 'rollAttack') {
          setTimeout(() => {
            // Create a spell attack roll (d20 + spell level + proficiency)
            const spellAttackRoll = `1d20+${parseInt(spellLevel) || 0}+${characterData.proficiencyBonus || 2}`;
            debug.log(' Rolling spell attack:', spellAttackRoll);
            rollSimultaneously(`${spellName} Spell Attack`, spellAttackRoll);
          }, 200);
        }
      });
    });

    // Add skill card listeners
    document.querySelectorAll('.skill-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const skillName = card.querySelector('.skill-name').textContent;
        const skillBonus = card.querySelector('.skill-bonus').textContent;
        debug.log(` Clicked skill card: ${skillName} (${skillBonus})`);
        
        // Make announcement in Roll20 chat first
        const characterName = characterData?.name || 'Character';
        const announcement = `&{template:default} {{name=${characterName} - ${skillName}}} {{description=Skill Check}}`;
        postChatMessage(announcement);
        
        // Then roll the dice
        setTimeout(() => rollSimultaneously(skillName, `1d20${skillBonus}`), 100);
      });
    });

    // Add save card listeners
    document.querySelectorAll('.save-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const saveName = card.querySelector('.save-name').textContent;
        const saveBonus = card.querySelector('.save-bonus').textContent;
        debug.log(` Clicked save card: ${saveName} (${saveBonus})`);
        
        // Make announcement in Roll20 chat first
        const characterName = characterData?.name || 'Character';
        const announcement = `&{template:default} {{name=${characterName} - ${saveName} Save}}} {{description=Saving Throw}}`;
        postChatMessage(announcement);
        
        // Then roll the dice
        setTimeout(() => rollSimultaneously(`${saveName} Save`, `1d20${saveBonus}`), 100);
      });
    });

    // Add settings toggle listeners (moved here to ensure buttons exist)
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.getAttribute('data-mode');
        setAdvantageMode(mode);
      });
    });

    // Add initiative button listener
    const initiativeBtn = document.getElementById('initiative-btn');
    if (initiativeBtn) {
      initiativeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const initiative = characterData.initiative || 0;
        debug.log(` Initiative check: 1d20+${initiative}`);
        
        // Make announcement in Roll20 chat first
        const characterName = characterData?.name || 'Character';
        const announcement = `&{template:default} {{name=${characterName} - Initiative Check}}} {{description=Rolling for initiative}}`;
        postChatMessage(announcement);
        
        // Then roll the dice
        setTimeout(() => rollSimultaneously('Initiative Check', `1d20+${initiative}`), 100);
      });
    }
  }

  /**
   * Toggles panel visibility
   */
  function togglePanel(panelName) {
    const panel = document.getElementById(`${panelName}-panel`);
    const content = panel.querySelector('.panel-content');
    const toggle = document.getElementById(`${panelName}-toggle`);
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      toggle.textContent = '−';
    } else {
      content.style.display = 'none';
      toggle.textContent = '+';
    }
  }

  /**
   * Sets the advantage mode
   */
  function setAdvantageMode(mode) {
    rollStats.settings.advantageMode = mode;
    
    // Update button states
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      const btnMode = btn.getAttribute('data-mode');
      if (btnMode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    debug.log(`🎲 Roll mode set to: ${mode}`);
  }

  /**
   * Updates roll statistics
   */
  function updateRollStatistics(rollData) {
    const result = parseInt(rollData.result);
    if (isNaN(result)) return;

    rollStats.stats.totalRolls++;
    rollStats.stats.highestRoll = Math.max(rollStats.stats.highestRoll, result);
    rollStats.stats.lowestRoll = Math.min(rollStats.stats.lowestRoll, result);

    // Update average (running average)
    rollStats.stats.averageRoll =
      (rollStats.stats.averageRoll * (rollStats.stats.totalRolls - 1) + result) /
      rollStats.stats.totalRolls;

    // Check for criticals
    const formula = rollData.formula.toLowerCase();
    if (formula.includes('d20') || formula.includes('1d20')) {
      if (result === 20) {
        rollStats.stats.criticalSuccesses++;
      } else if (result === 1) {
        rollStats.stats.criticalFailures++;
      }
    }

    updateStatsDisplay();
  }

  /**
   * Updates statistics display
   */
  function updateStatsDisplay() {
    // Check if elements exist (they won't exist if overlay is in popup window)
    const statTotal = document.getElementById('stat-total');
    if (!statTotal) return; // Overlay not on this page

    statTotal.textContent = rollStats.stats.totalRolls;
    document.getElementById('stat-average').textContent = rollStats.stats.averageRoll.toFixed(1);
    document.getElementById('stat-highest').textContent = rollStats.stats.highestRoll;
    document.getElementById('stat-lowest').textContent =
      rollStats.stats.lowestRoll === Infinity ? '∞' : rollStats.stats.lowestRoll;
    document.getElementById('stat-crits').textContent = rollStats.stats.criticalSuccesses;
    document.getElementById('stat-fails').textContent = rollStats.stats.criticalFailures;
  }

  /**
   * Adds roll to history
   */
  function addToRollHistory(rollData) {
    const advantageType = rollStats.settings.advantageMode;
    const criticalType = detectCritical(rollData);

    rollStats.history.unshift({
      ...rollData,
      advantageType,
      criticalType,
      timestamp: Date.now()
    });

    // Trim history
    if (rollStats.history.length > rollStats.settings.maxHistorySize) {
      rollStats.history = rollStats.history.slice(0, rollStats.settings.maxHistorySize);
    }

    updateRollHistoryDisplay();
    updateRollStatistics(rollData);
  }

  /**
   * Updates roll history display
   */
  function updateRollHistoryDisplay() {
    const historyList = document.getElementById('roll-history-list');
    if (!historyList) return;

    if (rollStats.history.length === 0) {
      historyList.innerHTML = '<div class="empty-state">No rolls yet. Make some rolls!</div>';
      return;
    }

    historyList.innerHTML = rollStats.history.map((roll, index) => {
      const timeAgo = getTimeAgo(roll.timestamp);
      const criticalClass = roll.criticalType || '';

      let badges = '';
      if (roll.criticalType) {
        badges += `<span class="history-badge ${roll.criticalType}">${roll.criticalType.replace('-', ' ')}</span>`;
      }
      if (roll.advantageType && roll.advantageType !== 'normal') {
        badges += `<span class="history-badge">${roll.advantageType}</span>`;
      }

      return `
        <div class="history-item ${criticalClass}" style="animation-delay: ${index * 0.05}s">
          <div class="history-item-header">
            <span class="history-name">${roll.name}</span>
            <span class="history-time">${timeAgo}</span>
          </div>
          <div class="history-formula">${roll.formula} = <strong>${roll.result}</strong></div>
          ${badges ? `<div class="history-badges">${badges}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Gets time ago string
   */
  function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Rolls in Dice Cloud and then forwards to Roll20
   */
  function rollSimultaneously(name, formula) {
    debug.log(`🎲 Rolling ${name} with formula ${formula}...`);

    // Check advantage mode and modify formula for Roll20 syntax
    const advantageMode = rollStats.settings.advantageMode;
    let modifiedFormula = formula;

    if (advantageMode === 'advantage') {
      // Roll20 syntax for advantage: 2d20kh1 (keep highest)
      modifiedFormula = formula.replace(/^1d20/, '2d20kh1');
      debug.log(`🎲 Advantage mode: ${formula} → ${modifiedFormula}`);
    } else if (advantageMode === 'disadvantage') {
      // Roll20 syntax for disadvantage: 2d20kl1 (keep lowest)
      modifiedFormula = formula.replace(/^1d20/, '2d20kl1');
      debug.log(`🎲 Disadvantage mode: ${formula} → ${modifiedFormula}`);
    }

    // Post roll directly to Roll20 - no DiceCloud needed!
    debug.log('🎯 Posting roll directly to Roll20 (no DiceCloud!)');
    showNotification(`Rolling ${name}... 🎲`, 'info');

    // Format roll for Roll20
    const rollMessage = `&{template:default} {{name=${name}}} {{Roll=[[${modifiedFormula}]]}}`;

    // Post to Roll20 chat
    const success = postChatMessage(rollMessage);

    if (success) {
      debug.log('✅ Roll posted directly to Roll20!');
      showNotification(`${name} rolled! 🎲`, 'success');

      // Track the roll in overlay history
      addToRollHistory({
        name: name,
        formula: modifiedFormula,
        timestamp: Date.now()
      });

      // Update overlay display if visible
      if (overlayVisible) {
        updateRollHistoryDisplay();
        updateStatsDisplay();
      }
    } else {
      debug.error('❌ Failed to post roll to Roll20');
      showNotification('Failed to roll. Make sure you\'re on Roll20!', 'error');
    }
  }

  /**
   * Initiates a roll in Dice Cloud by finding and clicking the appropriate button
   */
  function rollInDiceCloud(name, formula) {
    return new Promise((resolve, reject) => {
      // Check if we're on Dice Cloud
      if (!window.location.hostname.includes('dicecloud.com')) {
        reject(new Error('Not on Dice Cloud'));
        return;
      }

      // Try to find the roll button in Dice Cloud
      // This is a simplified approach - you may need to adjust based on Dice Cloud's actual UI
      const rollButtons = document.querySelectorAll('[class*="roll"], [class*="dice"], button');
      let found = false;

      rollButtons.forEach(button => {
        const buttonText = button.textContent || button.innerText || '';
        if (buttonText.toLowerCase().includes(name.toLowerCase()) || 
            buttonText.toLowerCase().includes('roll')) {
          debug.log('🎯 Found potential roll button:', buttonText);
          found = true;
          button.click();
          resolve();
        }
      });

      if (!found) {
        // Try to find by searching for the roll name in the page
        const allElements = document.querySelectorAll('*');
        for (let element of allElements) {
          const text = element.textContent || element.innerText || '';
          if (text.toLowerCase().includes(name.toLowerCase()) && 
              (element.tagName === 'BUTTON' || element.onclick)) {
            debug.log('🎯 Found roll element by text:', text);
            element.click();
            resolve();
            return;
          }
        }
        
        reject(new Error('Could not find roll button in Dice Cloud'));
      }
    });
  }

  /**
   * Direct roll in Roll20 (fallback)
   */
  function rollInRoll20(name, formula) {
    const rollData = {
      name: name,
      formula: formula,
      result: Math.floor(Math.random() * 20) + 1, // Simple fallback
      timestamp: Date.now()
    };

    // Send to Roll20
    browserAPI.runtime.sendMessage({
      action: 'postRollToChat',
      roll: rollData
    }, (response) => {
      if (browserAPI.runtime.lastError) {
        debug.error('❌ Error sending roll to Roll20:', browserAPI.runtime.lastError);
      } else {
        debug.log('✅ Roll sent to Roll20 directly');
        showNotification(`${name} roll sent to Roll20! 🎲`, 'success');
      }
    });
  }

  /**
   * Posts a message to Roll20 chat (fallback for character sheet overlay)
   */
  function postChatMessage(message) {
    try {
      // Find the chat input textarea
      const chatInput = document.querySelector('#textchat-input textarea');
      if (chatInput) {
        chatInput.value = message;
        chatInput.focus();
        
        // Trigger the send button
        const sendButton = document.querySelector('#textchat-input .btn');
        if (sendButton) {
          sendButton.click();
          debug.log('✅ Message posted to Roll20 chat:', message);
          return true;
        } else {
          debug.error('❌ Could not find Roll20 chat send button');
          return false;
        }
      } else {
        debug.error('❌ Could not find Roll20 chat input');
        return false;
      }
    } catch (error) {
      debug.error('❌ Error posting to Roll20 chat:', error);
      return false;
    }
  }

  /**
   * Detects critical hits/misses
   */
  function detectCritical(rollData) {
    const result = parseInt(rollData.result);
    const formula = rollData.formula.toLowerCase();

    // Check for d20 rolls
    if (formula.includes('d20') || formula.includes('1d20')) {
      if (result === 20) return 'critical-success';
      if (result === 1) return 'critical-failure';
    }
    return null;
  }

  /**
   * Shows a notification message
   */
  function showNotification(message, type = 'info') {
    // Add animation styles if not already present
    if (!document.querySelector('#notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes slideOut {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }
      `;
      document.head.appendChild(style);
    }

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#FC57F9' : type === 'error' ? '#E74C3C' : '#FC57F9'};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 100002;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 14px;
      max-width: 300px;
      animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  /**
   * Shows the overlay in a popup window instead of inline
   */
  function showOverlay() {
    // Load character data first
    browserAPI.runtime.sendMessage({ action: 'getCharacterData' }, (response) => {
      if (browserAPI.runtime.lastError) {
        debug.error('❌ Extension context error:', browserAPI.runtime.lastError);
        showNotification('Extension context error. Please refresh the page.', 'error');
        return;
      }

      if (response && response.data) {
        debug.log('✅ Character data loaded for popup:', response.data.name);

        // Get the popup HTML file URL
        const popupURL = browserAPI.runtime.getURL('src/popup-sheet.html');

        let messageSent = false;
        let popupWindow = null;

        // Set up message listener BEFORE opening the window to avoid race condition
        const messageHandler = (event) => {
          if (event.data && event.data.action === 'popupReady' && popupWindow && !messageSent) {
            debug.log('✅ Popup is ready, sending character data...');
            messageSent = true;
            try {
              popupWindow.postMessage({
                action: 'initCharacterSheet',
                data: response.data
              }, '*');
              debug.log('✅ Character data sent to popup via postMessage');
            } catch (error) {
              debug.warn('⚠️ Could not send message to popup (Firefox security):', error.message);
              // The popup will use storage fallback if postMessage fails
            }
            // Clean up listener after a delay
            setTimeout(() => {
              window.removeEventListener('message', messageHandler);
            }, 1000);
          }
        };
        window.addEventListener('message', messageHandler);

        // Close any existing popup window before opening a new one
        // Firefox can throw errors when accessing properties of closed windows
        try {
          if (activePopupWindow && !activePopupWindow.closed) {
            debug.log('📋 Closing existing popup window...');
            activePopupWindow.close();
          }
        } catch (error) {
          // Firefox throws "can't access dead object" error for closed windows
          debug.log('📋 Existing popup already closed (Firefox)');
        }
        // Always reset the reference before opening new window
        activePopupWindow = null;

        // Now open the popup window
        try {
          popupWindow = window.open(popupURL, 'rollcloud-character-sheet', 'width=900,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no,status=no');
        } catch (error) {
          debug.error(' Error opening popup window:', error);
          popupWindow = null;
        }

        if (!popupWindow) {
          debug.error(' Failed to open popup window. Please allow popups for this site.');
          showNotification('Popup blocked. Please allow popups for this site. Retrying...', 'error');
          window.removeEventListener('message', messageHandler);
          
          // Retry after a short delay
          setTimeout(() => {
            debug.log(' Retrying popup window open...');
            showOverlay();
          }, 1000);
          return;
        }

        // Store reference to the active popup
        activePopupWindow = popupWindow;

        // Fallback: Send data after a delay if popup hasn't sent ready message
        // This handles cases where the popup loads faster than expected
        setTimeout(() => {
          if (!messageSent && popupWindow) {
            try {
              // Firefox can throw "dead object" error even when accessing .closed property
              if (!popupWindow.closed) {
                debug.log('⏱️ Fallback: Sending character data after timeout...');
                messageSent = true;
                popupWindow.postMessage({
                  action: 'initCharacterSheet',
                  data: response.data
                }, '*');
                debug.log('✅ Character data sent via fallback');
              }
            } catch (error) {
              debug.warn('⚠️ Could not send fallback message to popup (Firefox security):', error.message);
              // The popup will load data from storage if postMessage fails
            }
          }
        }, 500);

        overlayVisible = true;
        showNotification('Character sheet opened! 🎲', 'success');
        debug.log('✅ Popup window opened successfully');

      } else {
        debug.log('📋 No character data found - asking user about GM mode');

        // Ask user if they want to open GM mode instead
        const userConfirmed = confirm('No character data found.\n\nWould you like to open GM mode instead?');

        if (userConfirmed) {
          // User clicked "Yes" - trigger GM mode via roll20.js
          debug.log('✅ User confirmed - requesting GM mode via showCharacterSheet');
          // Send message to roll20.js to open GM mode
          // This will trigger the same flow as the popup button
          const event = new CustomEvent('openGMMode');
          document.dispatchEvent(event);
          showNotification('Opening GM mode...', 'success');
        } else {
          // User clicked "Cancel" - just show error
          debug.log('ℹ️ User cancelled GM mode opening');
          showNotification('No character data found. Please sync from Dice Cloud first.', 'error');
        }
      }
    });
  }

  /**
   * Hides the overlay
   */
  function hideOverlay() {
    if (overlayElement) {
      overlayElement.style.display = 'none';
    }
    overlayVisible = false;
  }

  // NOTE: announceToRoll20() function removed - spell announcements now handled solely by roll20.js to prevent duplicates

  // Listen for messages from popout window
  window.addEventListener('message', (event) => {
    // NOTE: rollFromPopout is handled by roll20.js - do NOT handle it here to avoid duplicate rolls
    if (event.data.action === 'updateCharacterData') {
      debug.log('💾 Received character data update from popup:', event.data.data);

      // Save updated character data to storage
      browserAPI.runtime.sendMessage({
        action: 'storeCharacterData',
        data: event.data.data
      }, (response) => {
        if (response && response.success) {
          debug.log('✅ Character data updated successfully');
        } else {
          debug.error('❌ Failed to update character data');
        }
      });
    }

    // NOTE: announceSpell is handled by roll20.js to prevent duplicate messages
  });

  // Listen for messages from background script
  /**
   * Makes a button draggable and adds hide/show functionality
   */
  function makeButtonDraggable(button, storageKey) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    // Helper function to validate if position is within viewport
    function isPositionValid(left, top) {
      const leftPx = parseFloat(left);
      const topPx = parseFloat(top);

      // Check if position is within reasonable viewport bounds
      // Allow some negative values but not completely off-screen
      const minTop = -20; // Allow slightly above viewport (for aesthetic dragging)
      const maxTop = window.innerHeight - 20; // Ensure at least 20px visible at bottom
      const minLeft = -100; // Allow partially off left edge
      const maxLeft = window.innerWidth - 20; // Ensure at least 20px visible on right

      return topPx >= minTop && topPx <= maxTop && leftPx >= minLeft && leftPx <= maxLeft;
    }

    // Load saved position
    const savedPosition = localStorage.getItem(`${storageKey}_position`);
    if (savedPosition) {
      const { left, top } = JSON.parse(savedPosition);

      // Validate position before applying it
      if (isPositionValid(left, top)) {
        button.style.left = left;
        button.style.top = top;
        button.style.transform = 'none'; // Remove centering transform when positioned
      } else {
        // Invalid position detected - clear it and log
        debug.log(`🔧 Clearing invalid button position: left=${left}, top=${top}`);
        localStorage.removeItem(`${storageKey}_position`);
        // Keep default centered position
      }
    }

    // Load saved visibility
    const savedVisibility = localStorage.getItem(`${storageKey}_hidden`);
    if (savedVisibility === 'true') {
      button.style.display = 'none';
    }

    button.addEventListener('mousedown', (e) => {
      // Only start dragging on left click
      if (e.button === 0) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        // Batch layout read before style writes to avoid forced reflow
        const rect = button.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Defer style writes to next frame
        requestAnimationFrame(() => {
          button.style.cursor = 'grabbing';
          button.style.transform = 'none'; // Remove any transform during drag
        });

        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const newLeft = initialLeft + deltaX;
        const newTop = initialTop + deltaY;

        // Use requestAnimationFrame to avoid forced reflow
        requestAnimationFrame(() => {
          button.style.left = `${newLeft}px`;
          button.style.top = `${newTop}px`;
        });
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        button.style.cursor = 'pointer';

        // Validate and save position only if it's within viewport
        if (isPositionValid(button.style.left, button.style.top)) {
          localStorage.setItem(`${storageKey}_position`, JSON.stringify({
            left: button.style.left,
            top: button.style.top
          }));
        } else {
          // Position is off-screen, don't save it
          debug.log('⚠️ Button position is off-screen, not saving');
        }
      }
    });

    // Right-click context menu
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Create context menu
      const existingMenu = document.getElementById('rollcloud-context-menu');
      if (existingMenu) existingMenu.remove();

      const menu = document.createElement('div');
      menu.id = 'rollcloud-context-menu';

      // Get adjusted position within viewport bounds
      const position = getPopupPosition(e.clientX, e.clientY, 200, 150);

      menu.style.cssText = `
        position: fixed;
        left: ${position.x}px;
        top: ${position.y}px;
        background: #1a1a1a;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000000;
        padding: 5px 0;
      `;

      const hideOption = document.createElement('div');
      hideOption.textContent = '🙈 Hide Button';
      hideOption.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
      `;
      hideOption.addEventListener('mouseenter', () => {
        hideOption.style.background = '#f0f0f0';
      });
      hideOption.addEventListener('mouseleave', () => {
        hideOption.style.background = 'white';
      });
      hideOption.addEventListener('click', () => {
        button.style.display = 'none';
        localStorage.setItem(`${storageKey}_hidden`, 'true');
        menu.remove();
        showNotification('Button hidden. Use extension popup to show it again.', 'info');
      });

      const resetOption = document.createElement('div');
      resetOption.textContent = '🔄 Reset Position';
      resetOption.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
        border-top: 1px solid #eee;
      `;
      resetOption.addEventListener('mouseenter', () => {
        resetOption.style.background = '#f0f0f0';
      });
      resetOption.addEventListener('mouseleave', () => {
        resetOption.style.background = 'white';
      });
      resetOption.addEventListener('click', () => {
        localStorage.removeItem(`${storageKey}_position`);
        if (storageKey === 'rollcloud-sheet-toggle') {
          button.style.left = '50%';
          button.style.top = '20px';
          button.style.transform = 'translateX(-50%)';
        } else {
          button.style.left = '20px';
          button.style.top = 'auto';
          button.style.bottom = '20px';
        }
        menu.remove();
        showNotification('Button position reset', 'success');
      });

      menu.appendChild(hideOption);
      menu.appendChild(resetOption);
      document.body.appendChild(menu);

      // Close menu when clicking outside
      setTimeout(() => {
        document.addEventListener('click', () => {
          menu.remove();
        }, { once: true });
      }, 0);
    });
  }

  /**
   * Creates the toggle button for opening the character sheet
   */
  function createToggleButton() {
    // Check if button already exists
    if (document.getElementById('rollcloud-sheet-toggle')) {
      debug.log('⚠️ Character sheet button already exists');
      return;
    }

    const button = document.createElement('button');
    button.id = 'rollcloud-sheet-toggle';
    button.innerHTML = '📋 Character Sheet';
    button.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #FC57F9 0%, #8E0682 100%);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(252, 87, 249, 0.3);
      z-index: 999998;
      transition: transform 0.2s, box-shadow 0.2s;
      user-select: none;
    `;

    // Hover effects
    button.addEventListener('mouseenter', () => {
      if (!button.style.left || button.style.left === '50%') {
        button.style.transform = 'translateX(-50%) translateY(-2px)';
      }
      button.style.boxShadow = '0 6px 20px rgba(252, 87, 249, 0.5)';
    });

    button.addEventListener('mouseleave', () => {
      if (!button.style.left || button.style.left === '50%') {
        button.style.transform = 'translateX(-50%) translateY(0)';
      }
      button.style.boxShadow = '0 4px 15px rgba(252, 87, 249, 0.3)';
    });

    // Click to open popup
    button.addEventListener('click', () => {
      showOverlay();
    });

    document.body.appendChild(button);

    // Make it draggable and add hide/show functionality
    makeButtonDraggable(button, 'rollcloud-sheet-toggle');

    debug.log('✅ Character sheet button created');
  }

  // Listen for messages from background script
  browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'postRollToChat') {
      // Handle roll from DiceCloud
      if (request.roll) {
        debug.log('🎲 Received roll in overlay:', request.roll);

        // Only add to history if it's an actual roll (has a formula)
        // Announcements like spells/actions don't have formulas
        if (request.roll.formula) {
          addToRollHistory(request.roll);
        }

        // Show notification
        showNotification(`Roll received: ${request.roll.name || 'dice roll'}`, 'success');

        // Update overlay if visible
        if (overlayVisible) {
          updateRollHistoryDisplay();
          updateStatsDisplay();
        }
      }
      sendResponse({ success: true });
    } else if (request.action === 'showCharacterSheetButton') {
      // Show the character sheet button
      const button = document.getElementById('rollcloud-sheet-toggle');
      if (button) {
        button.style.display = '';
        localStorage.removeItem('rollcloud-sheet-toggle_hidden');
        showNotification('Character Sheet button shown', 'success');
      }
      sendResponse({ success: true });
    } else if (request.action === 'showStatusBar') {
      // Show the status bar
      showStatusBar();
      showNotification('Status bar shown', 'success');
      sendResponse({ success: true });
    } else if (request.action === 'hideStatusBar') {
      // Hide the status bar
      hideStatusBar();
      sendResponse({ success: true });
    } else if (request.action === 'toggleStatusBar') {
      // Toggle the status bar visibility
      toggleStatusBar();
      sendResponse({ success: true, visible: statusBarVisible });
    } else if (request.action === 'refreshStatusBar') {
      // Refresh status bar with latest character data
      loadStatusBarData();
      sendResponse({ success: true });
    }
    return true;
  });

  // ============================================
  // STATUS BAR OVERLAY
  // ============================================

  let statusBarElement = null;
  let statusBarVisible = true; // Start visible by default
  let statusBarAdvantageState = 'normal';

  /**
   * Creates the compact status bar overlay
   */
  function createStatusBarOverlay() {
    if (statusBarElement) return;

    statusBarElement = document.createElement('div');
    statusBarElement.id = 'rollcloud-status-bar';
    statusBarElement.innerHTML = `
      <div class="status-bar-container">
        <div class="status-bar-header">
          <span class="status-char-name" id="status-char-name">Loading...</span>
          <button class="status-close-btn" id="status-close-btn">✕</button>
        </div>

        <!-- HP Row -->
        <div class="status-hp-row">
          <span class="status-hp-icon">❤️</span>
          <div class="status-hp-bar">
            <div class="status-hp-fill" id="status-hp-fill"></div>
            <div class="status-hp-text" id="status-hp-text">0/0</div>
          </div>
          <span class="status-temp-hp" id="status-temp-hp"></span>
        </div>

        <!-- Advantage Toggle -->
        <div class="status-adv-row">
          <button class="status-adv-btn adv" id="status-adv-btn" title="Advantage">⬆️</button>
          <button class="status-adv-btn norm active" id="status-norm-btn" title="Normal">🎲</button>
          <button class="status-adv-btn dis" id="status-dis-btn" title="Disadvantage">⬇️</button>
        </div>

        <!-- Concentration -->
        <div class="status-conc-row inactive" id="status-concentration">
          <span>🧠</span>
          <span class="status-conc-spell" id="status-conc-spell">—</span>
        </div>

        <!-- Spell Slots Dropdown -->
        <div class="status-slots-row" id="status-slots-row">
          <div class="status-slots-header" id="status-slots-header">
            <span>✨</span>
            <span class="status-slots-summary" id="status-slots-summary">Slots</span>
            <span class="status-slots-arrow">▼</span>
          </div>
          <div class="status-slots-dropdown" id="status-slots-dropdown"></div>
        </div>

        <!-- Resources -->
        <div class="status-resources-row" id="status-resources-row" style="display: none;">
          <div id="status-resources-list"></div>
        </div>

        <!-- Effects -->
        <div class="status-effects-row" id="status-effects-row">
          <span class="status-no-effects">No effects</span>
        </div>

        <!-- Resize Handle -->
        <div class="status-resize-handle" id="status-resize-handle"></div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'rollcloud-status-bar-styles';
    style.textContent = `
      #rollcloud-status-bar {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 180px;
        min-width: 150px;
        max-width: 400px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: 999997;
        user-select: none;
      }

      .status-bar-container {
        background: #1a1a1a;
        color: #e0e0e0;
        padding: 8px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        border: 1px solid #FC57F9;
        display: flex;
        flex-direction: column;
        gap: 5px;
        position: relative;
      }

      .status-bar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 5px;
        border-bottom: 1px solid #333;
      }

      .status-char-name {
        font-size: 14px;
        font-weight: bold;
        color: #FC57F9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
      }

      .status-close-btn {
        background: none;
        border: none;
        color: #555;
        font-size: 15px;
        cursor: pointer;
        padding: 2px;
        line-height: 1;
      }

      .status-close-btn:hover { color: #e74c3c; }

      /* HP Row */
      .status-hp-row {
        display: flex;
        align-items: center;
        gap: 5px;
        background: #2a2a2a;
        border-radius: 4px;
        padding: 5px;
      }

      .status-hp-icon { font-size: 15px; }

      .status-hp-bar {
        flex: 1;
        height: 18px;
        background: #1a1a1a;
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      }

      .status-hp-fill {
        height: 100%;
        background: linear-gradient(90deg, #8E0682, #FC57F9);
        transition: width 0.3s ease;
      }

      .status-hp-fill.low { background: linear-gradient(90deg, #e67e22, #f39c12); }
      .status-hp-fill.critical { background: linear-gradient(90deg, #c0392b, #e74c3c); }

      .status-hp-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 11px;
        font-weight: bold;
        color: white;
        text-shadow: 0 0 2px rgba(0,0,0,0.8);
      }

      .status-temp-hp {
        font-size: 11px;
        color: #3498db;
        font-weight: bold;
      }

      /* Advantage Toggle */
      .status-adv-row {
        display: flex;
        gap: 3px;
        background: #2a2a2a;
        border-radius: 4px;
        padding: 4px;
      }

      .status-adv-btn {
        flex: 1;
        padding: 5px 3px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 15px;
        background: #1a1a1a;
        transition: all 0.2s;
      }

      .status-adv-btn.adv { color: #8E0682; }
      .status-adv-btn.norm { color: #888; }
      .status-adv-btn.dis { color: #e74c3c; }

      .status-adv-btn.active.adv { background: #8E0682; color: white; }
      .status-adv-btn.active.norm { background: #3498db; color: white; }
      .status-adv-btn.active.dis { background: #e74c3c; color: white; }

      /* Concentration */
      .status-conc-row {
        display: flex;
        align-items: center;
        gap: 5px;
        background: #2a2a2a;
        border-radius: 4px;
        padding: 5px;
        font-size: 12px;
      }

      .status-conc-row.active {
        background: #2c3e50;
        border: 1px solid #9b59b6;
      }

      .status-conc-spell {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #9b59b6;
      }

      .status-conc-row.inactive .status-conc-spell { color: #555; }

      /* Spell Slots */
      .status-slots-row {
        position: relative;
        background: #2a2a2a;
        border-radius: 4px;
        padding: 5px;
      }

      .status-slots-header {
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        font-size: 12px;
      }

      .status-slots-summary {
        flex: 1;
        color: #9b59b6;
      }

      .status-slots-arrow {
        font-size: 10px;
        transition: transform 0.2s;
      }

      .status-slots-row.open .status-slots-arrow {
        transform: rotate(180deg);
      }

      .status-slots-dropdown {
        display: none;
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px solid #333;
      }

      .status-slots-row.open .status-slots-dropdown { display: block; }

      .status-slot-item {
        display: flex;
        justify-content: space-between;
        padding: 3px 0;
        font-size: 11px;
      }

      .status-slot-item .lvl { color: #888; }
      .status-slot-item .val { color: #9b59b6; font-weight: bold; }
      .status-slot-item .val.empty { color: #555; }
      .status-slot-item.pact .val { color: #1abc9c; }

      /* Resources */
      .status-resources-row {
        background: #2a2a2a;
        border-radius: 4px;
        padding: 4px;
      }

      .status-resource-item {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
        font-size: 11px;
      }

      .status-resource-item .name {
        color: #888;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 88px;
      }

      .status-resource-item .val { color: #f39c12; font-weight: bold; }

      /* Effects */
      .status-effects-row {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        background: #2a2a2a;
        border-radius: 4px;
        padding: 4px;
        min-height: 24px;
      }

      .status-effect-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
        font-weight: 500;
      }

      .status-effect-badge.buff {
        background: #8E0682;
        color: white;
      }

      .status-effect-badge.debuff {
        background: #c0392b;
        color: white;
      }

      .status-no-effects {
        color: #555;
        font-size: 11px;
        text-align: center;
        width: 100%;
      }

      /* Resize Handle */
      .status-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, #FC57F9 50%);
        border-radius: 0 0 8px 0;
        opacity: 0.5;
        transition: opacity 0.2s;
      }

      .status-resize-handle:hover {
        opacity: 1;
      }

      .status-resize-handle::before {
        content: '';
        position: absolute;
        bottom: 3px;
        right: 3px;
        width: 6px;
        height: 6px;
        border-right: 2px solid #1a1a1a;
        border-bottom: 2px solid #1a1a1a;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(statusBarElement);

    // Event listeners
    document.getElementById('status-close-btn').addEventListener('click', () => {
      hideStatusBar();
    });

    // Advantage toggle buttons
    document.getElementById('status-adv-btn').addEventListener('click', () => setStatusBarAdvantage('advantage'));
    document.getElementById('status-norm-btn').addEventListener('click', () => setStatusBarAdvantage('normal'));
    document.getElementById('status-dis-btn').addEventListener('click', () => setStatusBarAdvantage('disadvantage'));

    // Spell slots dropdown toggle
    document.getElementById('status-slots-header').addEventListener('click', () => {
      document.getElementById('status-slots-row').classList.toggle('open');
    });

    // Make status bar draggable
    makeStatusBarDraggable();

    // Make status bar resizable
    makeStatusBarResizable();

    // Load character data
    loadStatusBarData();

    debug.log('✅ Status bar overlay created');
  }

  /**
   * Makes the status bar draggable with viewport bounds checking
   */
  function makeStatusBarDraggable() {
    const statusBar = statusBarElement;
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    const header = statusBar.querySelector('.status-bar-header');

    // Status bar dimensions (approximate)
    const STATUS_BAR_WIDTH = 150;
    const STATUS_BAR_HEIGHT = 200;

    /**
     * Validates if a position is within viewport bounds
     */
    function isPositionValid(leftPx, topPx) {
      const minTop = -20;
      const maxTop = window.innerHeight - 40; // Ensure at least 40px visible
      const minLeft = -STATUS_BAR_WIDTH + 40; // Allow partial off left edge
      const maxLeft = window.innerWidth - 40; // Ensure at least 40px visible on right

      return topPx >= minTop && topPx <= maxTop && leftPx >= minLeft && leftPx <= maxLeft;
    }

    /**
     * Clamps a position to viewport bounds
     */
    function clampPosition(leftPx, topPx) {
      const minTop = 0;
      const maxTop = window.innerHeight - 40;
      const minLeft = 0;
      const maxLeft = window.innerWidth - STATUS_BAR_WIDTH;

      return {
        left: Math.max(minLeft, Math.min(maxLeft, leftPx)),
        top: Math.max(minTop, Math.min(maxTop, topPx))
      };
    }

    // Load saved position with validation
    const savedPosition = localStorage.getItem('rollcloud-status-bar_position');
    if (savedPosition) {
      const { left, top } = JSON.parse(savedPosition);
      const leftPx = parseFloat(left);
      const topPx = parseFloat(top);

      if (isPositionValid(leftPx, topPx)) {
        statusBar.style.left = left;
        statusBar.style.top = top;
        statusBar.style.right = 'auto';
        statusBar.style.bottom = 'auto';
      } else {
        // Invalid position - clear it and use default
        debug.log(`🔧 Clearing invalid status bar position: left=${left}, top=${top}`);
        localStorage.removeItem('rollcloud-status-bar_position');
      }
    }

    header.style.cursor = 'grab';

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('status-close-btn')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = statusBar.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = initialLeft + deltaX;
      let newTop = initialTop + deltaY;

      // Clamp to viewport bounds during drag
      const clamped = clampPosition(newLeft, newTop);
      newLeft = clamped.left;
      newTop = clamped.top;

      requestAnimationFrame(() => {
        statusBar.style.left = `${newLeft}px`;
        statusBar.style.top = `${newTop}px`;
        statusBar.style.right = 'auto';
        statusBar.style.bottom = 'auto';
      });
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';

        // Validate and save position only if within bounds
        const leftPx = parseFloat(statusBar.style.left);
        const topPx = parseFloat(statusBar.style.top);

        if (isPositionValid(leftPx, topPx)) {
          localStorage.setItem('rollcloud-status-bar_position', JSON.stringify({
            left: statusBar.style.left,
            top: statusBar.style.top
          }));
        } else {
          debug.log('⚠️ Status bar position is off-screen, not saving');
        }
      }
    });

    // Right-click context menu for reset
    statusBar.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const existingMenu = document.getElementById('status-bar-context-menu');
      if (existingMenu) existingMenu.remove();

      const menu = document.createElement('div');
      menu.id = 'status-bar-context-menu';
      menu.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        background: #1a1a1a;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000000;
        padding: 5px 0;
      `;

      const resetPositionOption = document.createElement('div');
      resetPositionOption.textContent = '🔄 Reset Position';
      resetPositionOption.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 14px;`;
      resetPositionOption.addEventListener('mouseenter', () => resetPositionOption.style.background = '#f0f0f0');
      resetPositionOption.addEventListener('mouseleave', () => resetPositionOption.style.background = 'white');
      resetPositionOption.addEventListener('click', () => {
        localStorage.removeItem('rollcloud-status-bar_position');
        statusBar.style.left = 'auto';
        statusBar.style.top = 'auto';
        statusBar.style.right = '20px';
        statusBar.style.bottom = '20px';
        menu.remove();
        showNotification('Status bar position reset', 'success');
      });

      const resetSizeOption = document.createElement('div');
      resetSizeOption.textContent = '📐 Reset Size';
      resetSizeOption.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 14px; border-top: 1px solid #eee;`;
      resetSizeOption.addEventListener('mouseenter', () => resetSizeOption.style.background = '#f0f0f0');
      resetSizeOption.addEventListener('mouseleave', () => resetSizeOption.style.background = 'white');
      resetSizeOption.addEventListener('click', () => {
        localStorage.removeItem('rollcloud-status-bar_size');
        statusBar.style.width = '150px';
        const container = statusBar.querySelector('.status-bar-container');
        if (container) {
          container.style.height = '';
          container.style.overflowY = '';
        }
        menu.remove();
        showNotification('Status bar size reset', 'success');
      });

      menu.appendChild(resetPositionOption);
      menu.appendChild(resetSizeOption);
      document.body.appendChild(menu);

      setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
      }, 0);
    });
  }

  /**
   * Makes the status bar resizable (width and height)
   */
  function makeStatusBarResizable() {
    const statusBar = statusBarElement;
    const container = statusBar.querySelector('.status-bar-container');
    const resizeHandle = document.getElementById('status-resize-handle');
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    // Load saved size
    const savedSize = localStorage.getItem('rollcloud-status-bar_size');
    if (savedSize) {
      const { width, height } = JSON.parse(savedSize);
      if (width >= 120 && width <= 400) {
        statusBar.style.width = `${width}px`;
      }
      if (height >= 100 && height <= 600) {
        container.style.height = `${height}px`;
        container.style.overflowY = 'auto';
      }
    }

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = statusBar.offsetWidth;
      startHeight = container.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Calculate new dimensions
      let newWidth = startWidth + deltaX;
      let newHeight = startHeight + deltaY;

      // Clamp to min/max
      newWidth = Math.max(120, Math.min(400, newWidth));
      newHeight = Math.max(100, Math.min(600, newHeight));

      requestAnimationFrame(() => {
        statusBar.style.width = `${newWidth}px`;
        container.style.height = `${newHeight}px`;
        container.style.overflowY = 'auto';
      });
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;

        // Save size
        localStorage.setItem('rollcloud-status-bar_size', JSON.stringify({
          width: statusBar.offsetWidth,
          height: container.offsetHeight
        }));
      }
    });
  }

  /**
   * Sets the advantage state in the status bar
   */
  function setStatusBarAdvantage(state) {
    statusBarAdvantageState = state;

    // Update UI
    document.querySelectorAll('.status-adv-btn').forEach(btn => btn.classList.remove('active'));

    if (state === 'advantage') {
      document.getElementById('status-adv-btn').classList.add('active');
    } else if (state === 'disadvantage') {
      document.getElementById('status-dis-btn').classList.add('active');
    } else {
      document.getElementById('status-norm-btn').classList.add('active');
    }

    // Sync with overlay roll settings
    rollStats.settings.advantageMode = state;

    // Update overlay toggle buttons if they exist
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      const btnMode = btn.getAttribute('data-mode');
      if (btnMode === state) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    debug.log(`🎲 Status bar advantage set to: ${state}`);
  }

  /**
   * Loads character data into status bar
   */
  function loadStatusBarData() {
    browserAPI.runtime.sendMessage({ action: 'getCharacterData' }, (response) => {
      if (browserAPI.runtime.lastError) {
        debug.error('❌ Error loading status bar data:', browserAPI.runtime.lastError);
        return;
      }

      if (response && response.data) {
        characterData = response.data;
        updateStatusBarDisplay();
        debug.log('✅ Status bar data loaded:', response.data.name);
      } else {
        document.getElementById('status-char-name').textContent = 'No character';
      }
    });
  }

  /**
   * Updates the status bar display with current character data
   */
  function updateStatusBarDisplay() {
    if (!characterData) return;

    // Character name
    document.getElementById('status-char-name').textContent = characterData.name || 'Unknown';

    updateStatusBarHP();
    updateStatusBarConcentration();
    updateStatusBarSpellSlots();
    updateStatusBarResources();
    updateStatusBarEffects();
  }

  function updateStatusBarHP() {
    const hp = characterData.hitPoints || characterData.hit_points || {};
    const current = hp.current || 0;
    const max = hp.max || 1;
    const tempHP = characterData.temporaryHP || hp.temp || 0;

    const percentage = Math.max(0, Math.min(100, (current / max) * 100));

    const hpFill = document.getElementById('status-hp-fill');
    const hpText = document.getElementById('status-hp-text');
    const tempHPEl = document.getElementById('status-temp-hp');

    hpFill.style.width = `${percentage}%`;
    hpText.textContent = `${current}/${max}`;

    hpFill.className = 'status-hp-fill';
    if (percentage <= 25) hpFill.classList.add('critical');
    else if (percentage <= 50) hpFill.classList.add('low');

    tempHPEl.textContent = tempHP > 0 ? `+${tempHP}` : '';
  }

  function updateStatusBarConcentration() {
    const concEl = document.getElementById('status-concentration');
    const spellEl = document.getElementById('status-conc-spell');

    // Hide concentration row if character has no spell slots (e.g., rogues)
    const spellSlots = characterData.spellSlots || {};
    let hasSpellSlots = false;
    for (let level = 1; level <= 9; level++) {
      if ((spellSlots[`level${level}SpellSlotsMax`] || 0) > 0) {
        hasSpellSlots = true;
        break;
      }
    }
    // Also check for pact magic
    if ((spellSlots.pactMagicSlotsMax || 0) > 0) {
      hasSpellSlots = true;
    }

    if (!hasSpellSlots) {
      concEl.style.display = 'none';
      return;
    }

    concEl.style.display = 'flex';

    // Support both formats: concentrationSpell (from postMessage) and concentration (from storage)
    const spell = characterData.concentrationSpell || characterData.concentration || '';

    if (spell) {
      concEl.classList.remove('inactive');
      concEl.classList.add('active');
      spellEl.textContent = spell;
    } else {
      concEl.classList.remove('active');
      concEl.classList.add('inactive');
      spellEl.textContent = '—';
    }
  }

  function updateStatusBarSpellSlots() {
    const spellSlots = characterData.spellSlots || {};
    const slotsRow = document.getElementById('status-slots-row');
    const dropdown = document.getElementById('status-slots-dropdown');
    const summary = document.getElementById('status-slots-summary');

    const slots = [];
    let totalCurrent = 0;
    let totalMax = 0;

    // Regular spell slots (levels 1-9)
    for (let level = 1; level <= 9; level++) {
      const current = spellSlots[`level${level}SpellSlots`] || 0;
      const max = spellSlots[`level${level}SpellSlotsMax`] || 0;

      if (max > 0) {
        slots.push({ level: level, current, max, type: 'regular' });
        totalCurrent += current;
        totalMax += max;
      }
    }

    // Pact Magic
    const pactCurrent = spellSlots.pactMagicSlots || 0;
    const pactMax = spellSlots.pactMagicSlotsMax || 0;
    const pactLevel = spellSlots.pactMagicLevel || 0;

    if (pactMax > 0) {
      slots.push({ level: `P${pactLevel}`, current: pactCurrent, max: pactMax, type: 'pact' });
      totalCurrent += pactCurrent;
      totalMax += pactMax;
    }

    if (slots.length === 0) {
      slotsRow.style.display = 'none';
      return;
    }

    slotsRow.style.display = 'block';
    summary.textContent = `${totalCurrent}/${totalMax}`;

    dropdown.innerHTML = slots.map(slot => `
      <div class="status-slot-item ${slot.type === 'pact' ? 'pact' : ''}">
        <span class="lvl">${slot.type === 'pact' ? 'Pact' : 'Lv' + slot.level}</span>
        <span class="val ${slot.current === 0 ? 'empty' : ''}">${slot.current}/${slot.max}</span>
      </div>
    `).join('');
  }

  function updateStatusBarResources() {
    const resources = characterData.resources || [];
    const resourcesRow = document.getElementById('status-resources-row');
    const resourcesList = document.getElementById('status-resources-list');

    // Filter out HP, Lucky, Spell Level, and zero-max resources
    const filteredResources = resources.filter(r => {
      const name = (r.name || '').toLowerCase();
      return r.max > 0 && !name.includes('hit points') && !name.includes('lucky') && !name.includes('spell level');
    });

    if (filteredResources.length === 0) {
      resourcesRow.style.display = 'none';
      return;
    }

    resourcesRow.style.display = 'block';
    resourcesList.innerHTML = filteredResources.slice(0, 4).map(r => `
      <div class="status-resource-item">
        <span class="name" title="${r.name}">${r.name}</span>
        <span class="val">${r.current}/${r.max}</span>
      </div>
    `).join('');
  }

  function updateStatusBarEffects() {
    // Support both data formats:
    // - Direct: activeBuffs/activeDebuffs (from postMessage)
    // - Nested: activeEffects.buffs/debuffs (from storage)
    const activeEffects = characterData.activeEffects || {};
    const buffs = characterData.activeBuffs || activeEffects.buffs || [];
    const debuffs = characterData.activeDebuffs || activeEffects.debuffs || [];
    const effectsRow = document.getElementById('status-effects-row');

    const allEffects = [
      ...buffs.map(b => ({ name: typeof b === 'string' ? b : b.name, type: 'buff' })),
      ...debuffs.map(d => ({ name: typeof d === 'string' ? d : d.name, type: 'debuff' }))
    ];

    if (allEffects.length === 0) {
      effectsRow.innerHTML = '<span class="status-no-effects">No effects</span>';
      return;
    }

    effectsRow.innerHTML = allEffects.map(e => {
      return `<span class="status-effect-badge ${e.type}">${e.name}</span>`;
    }).join('');
  }

  /**
   * Shows the status bar
   */
  function showStatusBar() {
    if (statusBarElement) {
      statusBarElement.style.display = 'block';
      statusBarVisible = true;
      localStorage.removeItem('rollcloud-status-bar_hidden');
    }
  }

  /**
   * Hides the status bar
   */
  function hideStatusBar() {
    if (statusBarElement) {
      statusBarElement.style.display = 'none';
      statusBarVisible = false;
      localStorage.setItem('rollcloud-status-bar_hidden', 'true');
      showNotification('Status bar hidden. Use extension popup to show again.', 'info');
    }
  }

  /**
   * Toggles the status bar visibility
   */
  function toggleStatusBar() {
    if (statusBarVisible) {
      hideStatusBar();
    } else {
      showStatusBar();
      showNotification('Status bar shown', 'success');
    }
  }

  /**
   * Initializes the status bar overlay
   */
  function initializeStatusBar() {
    createStatusBarOverlay();

    // Check if it was previously hidden
    const wasHidden = localStorage.getItem('rollcloud-status-bar_hidden');
    if (wasHidden === 'true') {
      statusBarElement.style.display = 'none';
      statusBarVisible = false;
    } else {
      // Start visible by default
      statusBarElement.style.display = 'block';
      statusBarVisible = true;
    }

    debug.log('✅ Status bar overlay initialized');
  }

  // Listen for status bar data updates
  window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'updateStatusData') {
      characterData = event.data.data;
      if (statusBarElement) {
        updateStatusBarDisplay();
      }
    } else if (event.data && event.data.action === 'updateAdvantageState') {
      setStatusBarAdvantage(event.data.state);
    }
  });

  // Periodic refresh of status bar data (fallback)
  setInterval(() => {
    if (statusBarVisible && statusBarElement) {
      loadStatusBarData();
    }
  }, 5000);

  // Listen for storage changes to update status bar immediately
  browserAPI.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && statusBarVisible && statusBarElement) {
      // Check if character data changed
      const relevantKeys = ['characterProfiles', 'activeCharacterId', 'characterData'];
      const hasRelevantChange = Object.keys(changes).some(key => relevantKeys.includes(key));

      if (hasRelevantChange) {
        debug.log('📊 Storage changed, refreshing status bar');
        loadStatusBarData();
      }
    }
  });

  // Initialize - wait for page to be fully loaded
  function initializeButton() {
    if (document.body) {
      // Clear any accidentally hidden state to ensure button is visible
      const wasHidden = localStorage.getItem('rollcloud-sheet-toggle_hidden');
      if (wasHidden === 'true') {
        debug.log('🔧 Clearing accidentally hidden button state');
        localStorage.removeItem('rollcloud-sheet-toggle_hidden');
      }

      // Clear any off-screen position to ensure button is visible
      const savedPosition = localStorage.getItem('rollcloud-sheet-toggle_position');
      if (savedPosition) {
        const { left, top } = JSON.parse(savedPosition);
        const leftPx = parseFloat(left);
        const topPx = parseFloat(top);

        // Check if position is off-screen (especially negative Y or far outside viewport)
        if (topPx < -20 || topPx > window.innerHeight - 20 || leftPx < -100 || leftPx > window.innerWidth - 20) {
          debug.log(`🔧 Clearing off-screen button position: left=${left}, top=${top}`);
          localStorage.removeItem('rollcloud-sheet-toggle_position');
        }
      }

      createToggleButton();
      debug.log('✅ RollCloud character sheet toggle button added');

      // Initialize status bar overlay
      initializeStatusBar();
    } else {
      debug.log('⏳ Waiting for document.body...');
      setTimeout(initializeButton, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initializeButton, 1000);
    });
  } else {
    setTimeout(initializeButton, 1000);
  }

  debug.log('✅ RollCloud character sheet overlay script loaded');

})();
   