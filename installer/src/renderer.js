/**
 * Renderer Process
 * Handles UI interactions for the installation wizard
 */

// State
let selectedBrowser = null;
let updaterInfo = { installed: false, directory: null };
let updaterConfig = {
  minimizeToTray: true,
  startWithWindows: true,
  enableNotifications: true
};

// DOM Elements
const steps = {
  step1: document.getElementById('step1'),
  stepUpdaterConfig: document.getElementById('stepUpdaterConfig'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  step4: document.getElementById('step4'),
  errorState: document.getElementById('errorState')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Get system info
  const systemInfo = await window.api.getSystemInfo();
  console.log('System info:', systemInfo);

  // Check if updater was installed by NSIS
  updaterInfo = await window.api.getUpdaterInfo();
  console.log('Updater info:', updaterInfo);

  // Set up event listeners
  setupBrowserSelection();
  if (updaterInfo.installed) {
    setupUpdaterConfig();
  }
  setupStep2();
  setupStep3();
  setupStep4();
  setupStep5();
  setupGlobalHandlers();
}

// ============================================================================
// Step 1: Browser Selection
// ============================================================================

function setupBrowserSelection() {
  const browserBtns = document.querySelectorAll('.browser-btn');
  const statusText = document.getElementById('browserStatus');

  browserBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      // Remove selection from all buttons
      browserBtns.forEach(b => b.classList.remove('selected'));

      // Select this button
      btn.classList.add('selected');
      selectedBrowser = btn.dataset.browser;

      // Check if already installed
      statusText.textContent = 'Checking installation status...';
      const isInstalled = await window.api.checkExtensionInstalled(selectedBrowser);

      if (isInstalled === 'policy_only') {
        // Policy is set but extension not yet installed
        statusText.innerHTML = `
          <div style="color: #ff9500;">🔄 Extension policy found!</div>
          <div style="font-size: 0.9em; margin-top: 5px;">Policy installed, but extension not yet active.</div>
          <div style="margin-top: 10px;">
            <button id="btnContinueFromPolicy" class="btn btn-primary">
              Continue Installation
            </button>
            <button id="btnClearPolicyAndReinstall" class="btn btn-secondary" style="margin-left: 10px;">
              Clear & Reinstall
            </button>
          </div>
          <div style="margin-top: 10px; font-size: 0.8em; color: #666;">
            The extension will be installed when you restart your browser, or clear to start fresh.
          </div>
        `;
        document.getElementById('btnContinueFromPolicy').addEventListener('click', () => goToStep(3));
        document.getElementById('btnClearPolicyAndReinstall').addEventListener('click', () => clearPolicyAndReinstall());
      } else if (isInstalled) {
        // Extension is installed, show options
        statusText.innerHTML = `
          <div style="color: #28a745;">✅ Extension found!</div>
          <div style="font-size: 0.9em; margin-top: 5px;">Extension is installed and ready.</div>
          <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
            <button id="btnContinueFromInstalled" class="btn btn-primary">
              Continue Installation
            </button>
            <button id="btnCheckUpdates" class="btn btn-secondary">
              Check for Updates
            </button>
            <button id="btnClearAndReinstall" class="btn btn-secondary">
              Reinstall
            </button>
            <button id="btnUninstallFromMain" class="btn btn-danger">
              🗑️ Uninstall
            </button>
          </div>
          <div style="margin-top: 10px; font-size: 0.8em; color: #666;">
            You can check for updates, reinstall, uninstall, or continue with current version.
          </div>
        `;
        document.getElementById('btnContinueFromInstalled').addEventListener('click', () => goToStep(3));
        document.getElementById('btnCheckUpdates').addEventListener('click', () => checkForUpdatesAndProceed());
        document.getElementById('btnClearAndReinstall').addEventListener('click', () => clearPolicyAndReinstall());
        document.getElementById('btnUninstallFromMain').addEventListener('click', () => handleUninstallExtension());
      } else {
        statusText.textContent = `Selected ${getBrowserName(selectedBrowser)}. Ready to install.`;
        statusText.innerHTML = `
          <div style="color: #22c55e;">✅ Ready to install!</div>
          <div style="font-size: 0.9em; margin-top: 5px;">Click Continue Installation to begin installation.</div>
          <div style="margin-top: 10px;">
            <button id="btnContinueToInstall" class="btn btn-primary">
              Continue Installation
            </button>
          </div>
          <div style="margin-top: 10px; font-size: 0.8em; color: #666;">
            The extension will be installed and configured automatically.
          </div>
        `;
        // Go to updater config if installed by NSIS, otherwise go to extension install
        document.getElementById('btnContinueToInstall').addEventListener('click', () => {
          if (updaterInfo.installed) {
            goToStep('updaterConfig');
          } else {
            goToStep(2);
          }
        });
      }
    });
  });
}

// ============================================================================
// Updater Configuration Step
// ============================================================================

function setupUpdaterConfig() {
  const minimizeToTrayCheckbox = document.getElementById('minimizeToTrayConfig');
  const startWithWindowsCheckbox = document.getElementById('startWithWindowsConfig');
  const enableNotificationsCheckbox = document.getElementById('enableNotificationsConfig');
  const continueBtn = document.getElementById('continueFromUpdaterConfig');

  // Track checkbox changes
  if (minimizeToTrayCheckbox) {
    minimizeToTrayCheckbox.addEventListener('change', (e) => {
      updaterConfig.minimizeToTray = e.target.checked;
    });
  }

  if (startWithWindowsCheckbox) {
    startWithWindowsCheckbox.addEventListener('change', (e) => {
      updaterConfig.startWithWindows = e.target.checked;
    });
  }

  if (enableNotificationsCheckbox) {
    enableNotificationsCheckbox.addEventListener('change', (e) => {
      updaterConfig.enableNotifications = e.target.checked;
    });
  }

  // Continue button - save config and proceed to browser selection
  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      // Save updater configuration
      await saveUpdaterConfig();
      // Proceed to browser selection
      goToStep(1);
    });
  }
}

async function saveUpdaterConfig() {
  const fs = require('fs');
  const path = require('path');

  try {
    const settingsPath = path.join(updaterInfo.directory, 'updater-settings.json');
    const settings = {
      minimizeToTray: updaterConfig.minimizeToTray,
      startMinimized: updaterConfig.minimizeToTray,
      enabled: updaterConfig.enableNotifications,
      runOnStartup: updaterConfig.startWithWindows,
      checkInterval: 3600000 // 1 hour
    };

    // Save via IPC since renderer can't write files directly
    const {app} = require('electron').remote;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Create startup shortcut if requested
    if (updaterConfig.startWithWindows) {
      const startupPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const shortcutPath = path.join(startupPath, 'RollCloud Updater.lnk');
      // This would need PowerShell - handled by NSIS instead
      console.log('Startup shortcut will be created by NSIS');
    }

    console.log('Updater configuration saved:', settings);
  } catch (error) {
    console.error('Failed to save updater config:', error);
  }
}

async function checkForUpdatesAndProceed() {
  const statusText = document.getElementById('browserStatus');
  
  try {
    const updateCheck = await window.api.checkForUpdates(selectedBrowser);
    
    if (updateCheck.success && updateCheck.updateAvailable) {
      // Update available
      statusText.innerHTML = `
        <div style="color: #ff9500;">🔄 Update available!</div>
        <div style="font-size: 0.9em; margin-top: 5px;">
          Current: v${updateCheck.currentVersion} → Latest: v${updateCheck.latestVersion}
        </div>
        <div style="margin-top: 10px;">
          <button id="btnUpdateExtension" class="btn btn-primary" style="background: #ff9500;">
            Update Extension
          </button>
          <button id="btnSkipUpdate" class="btn btn-secondary" style="margin-left: 10px;">
            Skip Update
          </button>
        </div>
      `;
      
      // Add event listeners
      document.getElementById('btnUpdateExtension').addEventListener('click', async () => {
        statusText.textContent = 'Updating extension...';
        try {
          const updateResult = await window.api.updateExtension(selectedBrowser);
          if (updateResult.success) {
            statusText.innerHTML = `
              <div style="color: #28a745;">✅ Update initiated!</div>
              <div style="font-size: 0.9em; margin-top: 5px;">${updateResult.message}</div>
              <div style="margin-top: 10px;">
                <button id="btnContinueAfterUpdate" class="btn btn-primary">
                  Continue Installation
                </button>
              </div>
            `;
            document.getElementById('btnContinueAfterUpdate').addEventListener('click', () => goToStep(3));
          } else {
            statusText.innerHTML = `
              <div style="color: #dc3545;">❌ Update failed</div>
              <div style="font-size: 0.9em; margin-top: 5px;">${updateResult.error}</div>
              <div style="margin-top: 10px;">
                <button id="btnRetryUpdate" class="btn btn-primary">Retry</button>
                <button id="btnSkipFailedUpdate" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
              </div>
            `;
            document.getElementById('btnRetryUpdate').addEventListener('click', () => checkForUpdatesAndProceed());
            document.getElementById('btnSkipFailedUpdate').addEventListener('click', () => goToStep(3));
          }
        } catch (error) {
          statusText.innerHTML = `
            <div style="color: #dc3545;">❌ Update failed</div>
            <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
            <div style="margin-top: 10px;">
              <button id="btnRetryUpdateError" class="btn btn-primary">Retry</button>
              <button id="btnSkipErrorUpdate" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
            </div>
          `;
          document.getElementById('btnRetryUpdateError').addEventListener('click', () => checkForUpdatesAndProceed());
          document.getElementById('btnSkipErrorUpdate').addEventListener('click', () => goToStep(3));
        }
      });
      
      document.getElementById('btnSkipUpdate').addEventListener('click', () => goToStep(3));
      
    } else if (updateCheck.success && !updateCheck.updateAvailable) {
      // Up to date
      statusText.innerHTML = `
        <div style="color: #28a745;">✅ Extension is up to date!</div>
        <div style="font-size: 0.9em; margin-top: 5px;">Version ${updateCheck.currentVersion}</div>
        <div style="margin-top: 10px;">
          <button id="btnContinueUpToDate" class="btn btn-primary">
            Continue Installation
          </button>
          <button id="btnReinstallAnyway" class="btn btn-secondary" style="margin-left: 10px;">
            🔄 Reinstall Anyway
          </button>
          <button id="btnUninstallExtension" class="btn btn-danger" style="margin-left: 10px;">
            🗑️ Uninstall Extension
          </button>
        </div>
        <div style="margin-top: 10px; font-size: 0.8em; color: #666;">
          Use reinstall if you're experiencing issues with the extension
        </div>
      `;
      document.getElementById('btnContinueUpToDate').addEventListener('click', () => goToStep(3));
      document.getElementById('btnReinstallAnyway').addEventListener('click', async () => {
        statusText.textContent = 'Force reinstalling extension...';
        try {
          const result = await window.api.forceReinstallExtension(selectedBrowser);
          if (result.success) {
            statusText.innerHTML = `
              <div style="color: #28a745;">✅ Extension force reinstalled!</div>
              <div style="font-size: 0.9em; margin-top: 5px;">${result.message}</div>
              <div style="margin-top: 10px;">
                <button id="btnContinueAfterReinstall" class="btn btn-primary">
                  Continue Installation
                </button>
              </div>
            `;
            document.getElementById('btnContinueAfterReinstall').addEventListener('click', () => goToStep(3));
          } else {
            statusText.innerHTML = `
              <div style="color: #dc3545;">❌ Force reinstall failed</div>
              <div style="font-size: 0.9em; margin-top: 5px;">${result.error}</div>
              <div style="margin-top: 10px;">
                <button id="btnRetryForceReinstall" class="btn btn-primary">Retry</button>
                <button id="btnSkipForceReinstall" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
              </div>
            `;
            document.getElementById('btnRetryForceReinstall').addEventListener('click', () => {
              statusText.textContent = 'Force reinstalling extension...';
              window.api.forceReinstallExtension(selectedBrowser);
            });
            document.getElementById('btnSkipForceReinstall').addEventListener('click', () => goToStep(3));
          }
        } catch (error) {
          statusText.innerHTML = `
            <div style="color: #dc3545;">❌ Force reinstall error</div>
            <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
            <div style="margin-top: 10px;">
              <button id="btnRetryForceReinstallError" class="btn btn-primary">Retry</button>
              <button id="btnSkipForceReinstallError" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
            </div>
          `;
          document.getElementById('btnRetryForceReinstallError').addEventListener('click', () => {
            statusText.textContent = 'Force reinstalling extension...';
            window.api.forceReinstallExtension(selectedBrowser);
          });
          document.getElementById('btnSkipForceReinstallError').addEventListener('click', () => goToStep(3));
        }
      });
      
      document.getElementById('btnUninstallExtension').addEventListener('click', async () => {
        if (confirm(`Are you sure you want to uninstall the RollCloud extension from ${selectedBrowser}? This will remove the extension and all its data.`)) {
          statusText.textContent = 'Uninstalling extension...';
          try {
            const result = await window.api.uninstallExtension(selectedBrowser);
            if (result.success) {
              statusText.innerHTML = `
                <div style="color: #28a745;">✅ Extension uninstalled!</div>
                <div style="font-size: 0.9em; margin-top: 5px;">${result.message}</div>
                <div style="font-size: 0.85em; margin-top: 5px; color: #666;">Restart your browser to complete the removal.</div>
                <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                  <button id="btnReinstallAfterUninstall" class="btn btn-primary">
                    Reinstall Extension
                  </button>
                  <button id="btnContinueAfterUninstall" class="btn btn-secondary">
                    Continue to Next Step
                  </button>
                  <button id="btnQuitAfterUninstall" class="btn btn-secondary">
                    Quit
                  </button>
                </div>
              `;
              document.getElementById('btnReinstallAfterUninstall').addEventListener('click', async () => {
                await restartBrowser(selectedBrowser);
                goToStep(2);
              });
              document.getElementById('btnContinueAfterUninstall').addEventListener('click', () => goToStep(3));
              document.getElementById('btnQuitAfterUninstall').addEventListener('click', () => window.api.quitApp());
            } else {
              statusText.innerHTML = `
                <div style="color: #dc3545;">❌ Uninstall failed</div>
                <div style="font-size: 0.9em; margin-top: 5px;">${result.error}</div>
                ${result.manual ? '<div style="margin-top: 5px; font-size: 0.8em; color: #666;">Please remove manually via browser Add-ons Manager.</div>' : ''}
                <div style="margin-top: 10px;">
                  <button id="btnRetryUninstall" class="btn btn-primary">Retry</button>
                  <button id="btnSkipUninstall" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
                </div>
              `;
              document.getElementById('btnRetryUninstall').addEventListener('click', () => {
                statusText.textContent = 'Uninstalling extension...';
                window.api.uninstallExtension(selectedBrowser);
              });
              document.getElementById('btnSkipUninstall').addEventListener('click', () => goToStep(3));
            }
          } catch (error) {
            statusText.innerHTML = `
              <div style="color: #dc3545;">❌ Uninstall error</div>
              <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
              <div style="margin-top: 10px;">
                <button id="btnRetryUninstall" class="btn btn-primary">Retry</button>
                <button id="btnSkipUninstall" class="btn btn-secondary" style="margin-left: 10px;">Skip</button>
              </div>
            `;
            document.getElementById('btnRetryUninstall').addEventListener('click', () => {
              statusText.textContent = 'Uninstalling extension...';
              window.api.uninstallExtension(selectedBrowser);
            });
            document.getElementById('btnSkipUninstall').addEventListener('click', () => goToStep(3));
          }
        }
      });
      
    } else {
      // Error checking for updates
      statusText.innerHTML = `
        <div style="color: #ffc107;">⚠️ Could not check for updates</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${updateCheck.error}</div>
        <div style="margin-top: 10px;">
          <button id="btnContinueAnyway" class="btn btn-primary">
            Continue Installation
          </button>
        </div>
      `;
      document.getElementById('btnContinueAnyway').addEventListener('click', () => goToStep(3));
    }
  } catch (error) {
    console.error('Update check failed:', error);
    statusText.innerHTML = `
      <div style="color: #dc3545;">❌ Error checking updates</div>
      <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
      <div style="margin-top: 10px;">
        <button id="btnContinueAfterError" class="btn btn-primary">
          Continue Installation
        </button>
      </div>
    `;
    document.getElementById('btnContinueAfterError').addEventListener('click', () => goToStep(3));
  }
}

async function clearPolicyAndReinstall() {
  const statusText = document.getElementById('browserStatus');

  try {
    statusText.innerHTML = `
      <div style="color: #ff9500;">🔄 Clearing existing installation...</div>
      <div style="font-size: 0.9em; margin-top: 5px;">Removing policy and preparing for reinstall...</div>
    `;

    // Uninstall existing extension/policy
    const uninstallResult = await window.api.uninstallExtension(selectedBrowser);

    if (uninstallResult.success) {
      statusText.innerHTML = `
        <div style="color: #28a745;">✅ Policy cleared!</div>
        <div style="font-size: 0.9em; margin-top: 5px;">Ready to reinstall. Click Continue to proceed.</div>
        <div style="margin-top: 10px;">
          <button id="btnProceedToInstall" class="btn btn-primary">
            Continue to Install
          </button>
        </div>
      `;
      document.getElementById('btnProceedToInstall').addEventListener('click', () => goToStep(2));
    } else {
      statusText.innerHTML = `
        <div style="color: #dc3545;">❌ Failed to clear policy</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${uninstallResult.error || 'Unknown error'}</div>
        <div style="margin-top: 10px;">
          <button id="btnRetryUninstall" class="btn btn-primary">Retry</button>
          <button id="btnSkipToContinue" class="btn btn-secondary" style="margin-left: 10px;">Continue Anyway</button>
        </div>
      `;
      document.getElementById('btnRetryUninstall').addEventListener('click', () => clearPolicyAndReinstall());
      document.getElementById('btnSkipToContinue').addEventListener('click', () => goToStep(2));
    }
  } catch (error) {
    console.error('Clear policy failed:', error);
    statusText.innerHTML = `
      <div style="color: #dc3545;">❌ Error clearing policy</div>
      <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
      <div style="margin-top: 10px;">
        <button id="btnRetryClear" class="btn btn-primary">Retry</button>
        <button id="btnSkipClear" class="btn btn-secondary" style="margin-left: 10px;">Continue Anyway</button>
      </div>
    `;
    document.getElementById('btnRetryClear').addEventListener('click', () => clearPolicyAndReinstall());
    document.getElementById('btnSkipClear').addEventListener('click', () => goToStep(2));
  }
}

async function handleUninstallExtension() {
  const statusText = document.getElementById('browserStatus');
  const browserName = getBrowserName(selectedBrowser);

  if (!confirm(`Are you sure you want to uninstall the RollCloud extension from ${browserName}?\n\nThis will remove the extension and all its data.`)) {
    return;
  }

  statusText.innerHTML = `
    <div style="color: #ff9500;">🔄 Uninstalling extension...</div>
    <div style="font-size: 0.9em; margin-top: 5px;">Please wait...</div>
  `;

  try {
    const result = await window.api.uninstallExtension(selectedBrowser);

    if (result.success) {
      statusText.innerHTML = `
        <div style="color: #28a745;">✅ Extension uninstalled!</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${result.message}</div>
        <div style="font-size: 0.85em; margin-top: 5px; color: #666;">Restart your browser to complete the removal.</div>
        <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="btnReinstallAfterUninstall" class="btn btn-primary">
            Reinstall Extension
          </button>
          <button id="btnRestartAfterUninstall" class="btn btn-secondary">
            Restart Browser
          </button>
          <button id="btnQuitAfterUninstall" class="btn btn-secondary">
            Quit
          </button>
        </div>
      `;
      document.getElementById('btnReinstallAfterUninstall').addEventListener('click', () => goToStep(2));
      document.getElementById('btnRestartAfterUninstall').addEventListener('click', () => restartBrowser(selectedBrowser));
      document.getElementById('btnQuitAfterUninstall').addEventListener('click', () => window.api.quitApp());
    } else {
      statusText.innerHTML = `
        <div style="color: #dc3545;">❌ Uninstall failed</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${result.error}</div>
        ${result.manual ? '<div style="margin-top: 5px; font-size: 0.8em; color: #666;">Please remove manually via browser Add-ons Manager.</div>' : ''}
        <div style="margin-top: 10px; display: flex; gap: 10px;">
          <button id="btnRetryUninstallMain" class="btn btn-primary">Retry</button>
          <button id="btnCancelUninstall" class="btn btn-secondary">Cancel</button>
        </div>
      `;
      document.getElementById('btnRetryUninstallMain').addEventListener('click', () => handleUninstallExtension());
      document.getElementById('btnCancelUninstall').addEventListener('click', () => {
        // Re-trigger browser selection to reset UI
        document.querySelector(`.browser-btn[data-browser="${selectedBrowser}"]`).click();
      });
    }
  } catch (error) {
    statusText.innerHTML = `
      <div style="color: #dc3545;">❌ Uninstall error</div>
      <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
      <div style="margin-top: 10px; display: flex; gap: 10px;">
        <button id="btnRetryUninstallError" class="btn btn-primary">Retry</button>
        <button id="btnCancelUninstallError" class="btn btn-secondary">Cancel</button>
      </div>
    `;
    document.getElementById('btnRetryUninstallError').addEventListener('click', () => handleUninstallExtension());
    document.getElementById('btnCancelUninstallError').addEventListener('click', () => {
      // Re-trigger browser selection to reset UI
      document.querySelector(`.browser-btn[data-browser="${selectedBrowser}"]`).click();
    });
  }
}

function getBrowserName(browser) {
  const names = {
    chrome: 'Google Chrome',
    firefox: 'Firefox Developer Edition'
  };
  return names[browser] || browser;
}

// ============================================================================
// Step 2: Install Extension
// ============================================================================

function setupStep2() {
  const continueBtn = document.getElementById('continueToStep3');
  const restartBtn = document.getElementById('restartBrowser');
  const retryBtn = document.getElementById('retryInstall');
  const backBtn = document.getElementById('backToStep1');
  const backBtnFromError = document.getElementById('backToStep1FromError');

  continueBtn.addEventListener('click', () => goToStep(3));
  restartBtn.addEventListener('click', () => restartBrowser(selectedBrowser));
  retryBtn.addEventListener('click', () => installExtensionAndUpdater());

  // Back button from error screen
  if (backBtnFromError) {
    backBtnFromError.addEventListener('click', () => {
      selectedBrowser = null;
      document.querySelectorAll('.browser-btn').forEach(btn => btn.classList.remove('selected'));
      document.getElementById('browserStatus').textContent = '';
      goToStep(1);
    });
  }

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      selectedBrowser = null;
      document.querySelectorAll('.browser-btn').forEach(btn => btn.classList.remove('selected'));
      document.getElementById('browserStatus').textContent = '';
      goToStep(1);
    });
  }
}

async function installExtension() {
  const progress = document.getElementById('installProgress');
  const complete = document.getElementById('installComplete');
  const error = document.getElementById('installError');
  const statusText = document.getElementById('installStatus');
  const browserName = document.getElementById('selectedBrowserName');

  // Reset UI
  progress.classList.remove('hidden');
  complete.classList.add('hidden');
  error.classList.add('hidden');

  browserName.textContent = getBrowserName(selectedBrowser);
  statusText.textContent = 'Installing extension...';

  try {
    console.log('🔧 Installing extension for:', selectedBrowser);
    console.log('🔧 CONFIG:', {
      extensionId: 'mkckngoemfjdkhcpaomdndlecolckgdj',
      chromeUpdateUrl: 'https://raw.githubusercontent.com/CarmaNayeli/rollCloud/main/updates/update_manifest.xml',
      firefoxUpdateUrl: 'https://github.com/CarmaNayeli/rollCloud/releases/latest/download/rollcloud-firefox-signed.xpi'
    });
    
    const result = await window.api.installExtension(selectedBrowser);

    console.log('🔧 Install result:', result);

    // Check for success or manual action required
    const isSuccess = (result.message && result.message.includes('Extension policy installed')) ||
                      (result.message && result.message.includes('manual installation')) ||
                      result.requiresManualAction === true;

    if (isSuccess) {
      progress.classList.add('hidden');
      complete.classList.remove('hidden');

      // Check if manual action is required
      if (result.requiresManualAction && result.manualInstructions) {
        const noteElement = document.querySelector('#installComplete .note');

        if (result.manualInstructions.type === 'firefox_addon') {
          noteElement.innerHTML = `
            <strong>Firefox extension installation started:</strong><br>
            Please follow these steps:<br>
            ${result.manualInstructions.steps.map(step => `<div style="margin: 5px 0;">${step}</div>`).join('')}
          `;
        } else if (result.manualInstructions.type === 'firefox_download') {
          noteElement.innerHTML = `
            <strong>Firefox Developer Edition Required</strong><br>
            Firefox Developer Edition is needed for this extension.<br><br>
            ${result.manualInstructions.steps.map(step => `<div style="margin: 5px 0;">${step}</div>`).join('')}
            <div style="margin-top: 15px;">
              <button id="btnDownloadFirefoxDev" class="action-btn" data-url="${result.manualInstructions.downloadUrl || 'https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org'}" style="background: #ff9500; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                Download Firefox Developer Edition
              </button>
            </div>
            <div style="margin-top: 10px;">
              <button id="btnRetryInstall" class="action-btn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                Retry Installation
              </button>
            </div>
          `;
          // Attach event listeners
          document.getElementById('btnDownloadFirefoxDev')?.addEventListener('click', (e) => {
            window.api.openExternal(e.target.dataset.url);
          });
          document.getElementById('btnRetryInstall')?.addEventListener('click', () => window.location.reload());
        } else if (result.manualInstructions.type === 'firefox_installation') {
          noteElement.innerHTML = `
            <strong>🔧 Installing Firefox Developer Edition</strong><br>
            The bundled installer is now running.<br><br>
            ${result.manualInstructions.steps.map(step => `<div style="margin: 5px 0;">${step}</div>`).join('')}
            <div style="margin-top: 15px; padding: 10px; background: #f0f0f0; color: #333; border-radius: 4px;">
              <strong>⏳ Please complete the Firefox Developer Edition installation wizard</strong><br>
              The installer should have opened automatically.<br>
              <div id="installProgress" style="margin-top: 10px; font-size: 0.9em;">
                Waiting for installation to complete...
              </div>
            </div>
            <div style="margin-top: 15px;">
              <button id="btnRetryAfterInstall" class="action-btn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                Installation Complete - Retry
              </button>
              <button id="btnSkipFirefoxInstall" class="action-btn" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px;">
                Skip & Continue
              </button>
            </div>
          `;
          document.getElementById('btnRetryAfterInstall')?.addEventListener('click', () => window.location.reload());
          document.getElementById('btnSkipFirefoxInstall')?.addEventListener('click', () => goToStep(3));
        } else if (result.manualInstructions.type === 'firefox_addon_manual') {
          noteElement.innerHTML = `
            <strong>Manual Firefox Installation:</strong><br>
            Please follow these steps to install the extension:<br>
            ${result.manualInstructions.steps.map(step => `<div style="margin: 5px 0;">${step}</div>`).join('')}
            ${result.manualInstructions.xpiPath ? `<div style="margin: 10px 0; padding: 10px; background: #f5f5f5; color: #333; border-radius: 4px; word-break: break-all;"><strong>XPI Location:</strong><br>${result.manualInstructions.xpiPath}</div>` : ''}
            <div style="margin-top: 15px;">
              <button id="btnRetryManual" class="action-btn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                Retry Installation
              </button>
            </div>
          `;
          document.getElementById('btnRetryManual')?.addEventListener('click', () => window.location.reload());
        } else {
          // Handle other manual installation types (fallback)
          const steps = result.manualInstructions.steps || [];
          noteElement.innerHTML = `
            <strong>Manual installation required:</strong><br>
            Please follow these steps:<br>
            ${steps.map(step => `<div style="margin: 5px 0;">${step}</div>`).join('')}
            ${result.manualInstructions.xpiPath ? `<div style="margin: 10px 0; padding: 10px; background: #f5f5f5; color: #333; border-radius: 4px; word-break: break-all;"><strong>File Location:</strong><br>${result.manualInstructions.xpiPath}</div>` : ''}
          `;
        }
      }
    } else {
      console.error('🔧 Install failed:', result);
      throw new Error(result.message || 'Installation failed');
    }
  } catch (err) {
    console.error('🔧 Install error:', err);
    progress.classList.add('hidden');
    error.classList.remove('hidden');
    document.getElementById('installErrorText').textContent = err.message;
  }
}

// ============================================================================
// Step 3: Add Pip 2
// ============================================================================

function setupStep3() {
  const addBotBtn = document.getElementById('addPipBot');
  const skipBotBtn = document.getElementById('skipPipBot');
  const continueBtn = document.getElementById('continueToStep4');
  const botAddedDiv = document.getElementById('botAdded');
  const backBtn = document.getElementById('backToStep2');
  const backBtnNav = document.getElementById('backToStep2Nav');

  addBotBtn.addEventListener('click', async () => {
    await window.api.openDiscordInvite();
    // Show continue button after opening Discord
    setTimeout(() => {
      botAddedDiv.classList.remove('hidden');
    }, 1000);
  });

  skipBotBtn.addEventListener('click', () => {
    // Skip directly to completion
    goToStep(4);
  });

  continueBtn.addEventListener('click', () => goToStep(4));

  // Back buttons
  const goBackToStep2 = () => {
    botAddedDiv.classList.add('hidden');
    goToStep(2);
  };

  backBtn.addEventListener('click', goBackToStep2);
  backBtnNav.addEventListener('click', goBackToStep2);
}

// ============================================================================
// Step 4: Done
// ============================================================================

function setupStep4() {
  const finishBtn = document.getElementById('finishSetup');
  const continueBtn = document.getElementById('continueToStep4');

  finishBtn.addEventListener('click', async () => {
    // Check if updater was installed
    const updaterInfo = await window.api.getUpdaterInfo();
    if (updaterInfo.installed) {
      // Show updater setup step
      showStep(5);
    } else {
      // No updater, just quit
      await window.api.quitApp();
    }
  });

  // Handle continue button with checkbox choice
  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      const installCheckbox = document.getElementById('installUpdaterCheckbox');
      const shouldInstallUpdater = installCheckbox && installCheckbox.checked;

      // Install updater if requested
      if (shouldInstallUpdater) {
        await installUpdaterUtility();
        showCompletionMessage();
      } else {
        showCompletionMessage();
      }
    });
  }
}

async function installUpdaterUtility() {
  const statusText = document.getElementById('browserStatus');
  
  statusText.innerHTML = `
    <div style="color: #ff9500;">🔄 Installing RollCloud Updater...</div>
    <div style="font-size: 0.9em; margin-top: 5px;">This will install a permanent updater utility on your system.</div>
    <div style="font-size: 0.85em; margin-top: 5px; color: #666;">The updater allows you to manage extensions without reinstalling.</div>
  `;

  try {
    const result = await window.api.installUpdater();
    
    if (result.success) {
      statusText.innerHTML = `
        <div style="color: #28a745;">✅ Updater installed successfully!</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${result.message}</div>
        <div style="font-size: 0.85em; margin-top: 5px; color: #666;">You can now run RollCloud Updater anytime from your Start Menu.</div>
        <div style="margin-top: 15px;">
          <button id="btnLaunchUpdater" class="btn btn-primary" style="background: #60a5fa; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            🚀 Launch Updater
          </button>
          <button id="btnFinishAfterUpdater" class="btn btn-secondary" style="background: #4ade80; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            ✅ Finish Installation
          </button>
        </div>
      `;
      
      document.getElementById('btnLaunchUpdater').addEventListener('click', () => {
        window.api.launchUpdater();
      });
      
      document.getElementById('btnFinishAfterUpdater').addEventListener('click', () => {
        window.api.quitApp();
      });
    } else {
      statusText.innerHTML = `
        <div style="color: #dc3545;">❌ Updater installation failed</div>
        <div style="font-size: 0.9em; margin-top: 5px;">${result.error}</div>
        <div style="margin-top: 10px;">
          <button id="btnRetryUpdater" class="btn btn-primary">Retry</button>
          <button id="btnSkipUpdater" class="btn btn-secondary">Skip</button>
        </div>
      `;
      
      document.getElementById('btnRetryUpdater').addEventListener('click', () => {
        installUpdaterUtility();
      });
      
      document.getElementById('btnSkipUpdater').addEventListener('click', () => {
        showCompletionMessage();
      });
    }
  } catch (error) {
    statusText.innerHTML = `
      <div style="color: #dc3545;">❌ Error installing updater</div>
      <div style="font-size: 0.9em; margin-top: 5px;">${error.message}</div>
      <div style="margin-top: 10px;">
        <button id="btnRetryUpdaterError" class="btn btn-primary">Retry</button>
        <button id="btnSkipUpdaterError" class="btn btn-secondary">Skip</button>
      </div>
    `;
    
    document.getElementById('btnRetryUpdaterError').addEventListener('click', () => {
      installUpdaterUtility();
    });
    
    document.getElementById('btnSkipUpdaterError').addEventListener('click', () => {
      showCompletionMessage();
    });
  }
}

// ============================================================================
// Step 5: Updater Setup (conditional)
// ============================================================================

async function setupStep5() {
  const finishBtn = document.getElementById('finishUpdaterSetup');
  const runUpdaterCheckbox = document.getElementById('runUpdaterCheckbox');
  const updaterPathEl = document.getElementById('updaterPath');

  // Get updater info
  const updaterInfo = await window.api.getUpdaterInfo();
  if (updaterInfo.directory) {
    updaterPathEl.textContent = updaterInfo.directory;
  }

  finishBtn.addEventListener('click', async () => {
    // Launch updater if checkbox is checked
    if (runUpdaterCheckbox && runUpdaterCheckbox.checked) {
      try {
        await window.api.launchUpdater();
      } catch (e) {
        console.warn('Failed to launch updater:', e);
      }
    }

    // Quit the wizard
    await window.api.quitApp();
  });
}

function showCompletionMessage() {
  const statusText = document.getElementById('browserStatus');

  statusText.innerHTML = `
    <div style="color: #4ade80;">✅ Installation Complete!</div>
    <div style="font-size: 0.9em; margin-top: 5px;">RollCloud extension is ready to use.</div>
    <div style="font-size: 0.85em; margin-top: 5px; color: #666;">You can install the updater later if needed.</div>
    <div style="margin-top: 15px;">
      <button id="btnFinishInstallation" class="btn btn-primary" style="background: #4ade80; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
        ✅ Finish Installation
      </button>
    </div>
  `;
  
  document.getElementById('btnFinishInstallation').addEventListener('click', () => {
    window.api.quitApp();
  });
}

// ============================================================================
// Navigation
// ============================================================================

function goToStep(stepNum) {
  // Hide all steps
  Object.values(steps).forEach(step => {
    step.classList.remove('active');
  });

  // Handle special step names
  if (stepNum === 'updaterConfig') {
    steps.stepUpdaterConfig.classList.add('active');
    return;
  }

  // Show target step
  const targetStep = steps[`step${stepNum}`];
  if (targetStep) {
    targetStep.classList.add('active');

    // Trigger step-specific actions
    if (stepNum === 2) {
      installExtension();
    }
  }
}

// Install extension and optionally the updater
async function installExtensionAndUpdater() {
  // First install the extension
  await installExtension();

  // If extension installed successfully and user wants updater, install it
  const installComplete = document.getElementById('installComplete');
  if (!installComplete.classList.contains('hidden') && updaterOptions.install) {
    await installUpdaterDuringSetup();
  }
}

// Install updater during the main setup flow
async function installUpdaterDuringSetup() {
  const statusDiv = document.getElementById('updaterInstallStatus');
  const progressDiv = document.getElementById('updaterInstallProgress');
  const successDiv = document.getElementById('updaterInstallSuccess');
  const errorDiv = document.getElementById('updaterInstallError');
  const errorText = document.getElementById('updaterErrorText');

  if (!statusDiv) return;

  // Show progress
  statusDiv.classList.remove('hidden');
  progressDiv.style.display = 'flex';
  successDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');

  try {
    const result = await window.api.installUpdaterWithOptions({
      minimizeToTray: updaterOptions.minimizeToTray,
      startWithWindows: updaterOptions.startWithWindows
    });

    progressDiv.style.display = 'none';

    if (result.success) {
      successDiv.classList.remove('hidden');
      console.log('Updater installed successfully:', result.message);
    } else {
      errorDiv.classList.remove('hidden');
      errorText.textContent = result.error || 'Unknown error';
      console.error('Updater installation failed:', result.error);
    }
  } catch (error) {
    progressDiv.style.display = 'none';
    errorDiv.classList.remove('hidden');
    errorText.textContent = error.message;
    console.error('Updater installation error:', error);
  }
}

function showError(message) {
  Object.values(steps).forEach(step => step.classList.remove('active'));
  steps.errorState.classList.add('active');
  steps.errorState.classList.remove('hidden');
  document.getElementById('globalErrorText').textContent = message;
}

// ============================================================================
// Global Handlers
// ============================================================================

function setupGlobalHandlers() {
  // Restart button
  document.getElementById('restartInstallation').addEventListener('click', () => {
    selectedBrowser = null;

    // Reset all UI
    document.querySelectorAll('.browser-btn').forEach(btn => btn.classList.remove('selected'));
    document.getElementById('browserStatus').textContent = '';
    document.getElementById('botAdded')?.classList.add('hidden');

    // Go back to step 1
    steps.errorState.classList.remove('active');
    steps.errorState.classList.add('hidden');
    goToStep(1);
    steps.step1.classList.add('active');
  });

  // Help link
  document.getElementById('helpLink').addEventListener('click', async (e) => {
    e.preventDefault();
    await window.api.openExternal('https://github.com/CarmaNayeli/rollCloud/issues');
  });
}

// Install Firefox Developer Edition
async function installFirefoxDevEdition() {
  const progress = document.getElementById('installProgress');
  const complete = document.getElementById('installComplete');
  const noteElement = document.querySelector('#installComplete .note');

  try {
    progress.classList.remove('hidden');
    complete.classList.add('hidden');

    noteElement.innerHTML = `
      <strong>Installing Firefox Developer Edition...</strong><br>
      The installer will download and install Firefox Developer Edition.<br>
      <div style="margin-top: 15px; padding: 10px; background: #f0f0f0; color: #333; border-radius: 4px;">
        Please wait for the Firefox installer to complete...
      </div>
    `;

    const result = await window.api.installFirefoxDevEdition();

    progress.classList.add('hidden');
    complete.classList.remove('hidden');

    if (result.success || result.installing) {
      noteElement.innerHTML = `
        <strong style="color: #ff9500;">📥 Firefox Installer Launched</strong><br>
        The Firefox Developer Edition installer is running.<br><br>
        <strong>Please:</strong>
        <div style="margin: 10px 0;">1. Complete the Firefox installation wizard</div>
        <div style="margin: 10px 0;">2. Click the button below when done</div>
        <div style="margin-top: 15px;">
          <button id="btnRetryAfterInstall" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            I've installed Firefox Dev - Continue
          </button>
        </div>
      `;
      document.getElementById('btnRetryAfterInstall')?.addEventListener('click', () => window.location.reload());
    } else if (result.openedDownloadPage) {
      noteElement.innerHTML = `
        <strong style="color: #ff9500;">📥 Download page opened</strong><br>
        Please download and install Firefox Developer Edition from the page that just opened.<br><br>
        <div style="margin-top: 15px;">
          <button id="btnRetryAfterDownload" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            I've installed Firefox Dev - Continue
          </button>
        </div>
        <div style="margin-top: 10px;">
          <button id="btnOpenDownloadAgain" style="background: #0060df; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            Open Download Page Again
          </button>
        </div>
      `;
      document.getElementById('btnRetryAfterDownload')?.addEventListener('click', () => window.location.reload());
      document.getElementById('btnOpenDownloadAgain')?.addEventListener('click', () => {
        window.api.openExternal(result.downloadUrl || 'https://www.mozilla.org/firefox/developer/');
      });
    } else {
      showFirefoxInstallError(result.message || result.error || 'Installation failed', noteElement);
    }

  } catch (err) {
    console.error('Failed to install Firefox Developer Edition:', err);
    progress.classList.add('hidden');
    complete.classList.remove('hidden');
    showFirefoxInstallError(err.message, noteElement);
  }
}

// Helper to show Firefox install error with buttons
function showFirefoxInstallError(errorMsg, noteElement) {
  noteElement.innerHTML = `
    <strong style="color: #dc3545;">❌ Firefox Developer Edition installation failed</strong><br>
    Error: ${errorMsg}<br><br>
    <div style="margin-top: 15px;">
      <button id="btnDownloadFirefox" style="background: #ff9500; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
        Download Manually
      </button>
    </div>
    <div style="margin-top: 10px;">
      <button id="btnRetryFirefox" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
        Retry Installation
      </button>
    </div>
  `;
  document.getElementById('btnDownloadFirefox')?.addEventListener('click', () => {
    window.api.openExternal('https://www.mozilla.org/firefox/developer/');
  });
  document.getElementById('btnRetryFirefox')?.addEventListener('click', () => window.location.reload());
}

// Restart browser function
async function restartBrowser(browser) {
  const browserName = getBrowserName(browser);

  const confirmed = confirm(`This will close and reopen ${browserName} to apply changes.\n\nMake sure you've saved any work in ${browserName} before continuing.\n\nRestart ${browserName} now?`);

  if (confirmed) {
    try {
      const result = await window.api.restartBrowser(browser);
      if (result.success) {
        alert(`${browserName} has been restarted.\n\nThe RollCloud extension should now be active.`);
      } else {
        alert(`Could not restart ${browserName} automatically.\n\nPlease close and reopen ${browserName} manually.\n\nTip: Make sure to close ALL ${browserName} windows, including any in the system tray.`);
      }
    } catch (error) {
      console.error('Browser restart error:', error);
      alert(`Could not restart ${browserName} automatically.\n\nPlease close and reopen ${browserName} manually.\n\nTip: Make sure to close ALL ${browserName} windows, including any in the system tray.`);
    }
  }
}
