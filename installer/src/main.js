const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { installExtension, uninstallExtension, isExtensionInstalled, installFirefoxDeveloperEdition, restartBrowser } = require('./extension-installer');
const { generatePairingCode, createPairing, createPairingAndSend, checkPairing } = require('./pairing');

// Get installer version from package.json
const INSTALLER_VERSION = require('../package.json').version;

// Extension and bot configuration
const CONFIG = {
  extensionId: 'mkckngoemfjdkhcpaomdndlecolckgdj', // Actual Chrome extension ID from signed CRX
  chromeUpdateUrl: 'https://raw.githubusercontent.com/CarmaNayeli/rollCloud/main/updates/update_manifest.xml',
  firefoxUpdateUrl: 'https://github.com/CarmaNayeli/rollCloud/releases/latest/download/rollcloud-firefox-signed.xpi',
  pip2InviteUrl: 'https://discord.com/api/oauth2/authorize?client_id=1464771468452827380&permissions=536870912&scope=bot%20applications.commands',
  supabaseUrl: 'https://gkfpxwvmumaylahtxqrk.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrZnB4d3ZtdW1heWxhaHR4cXJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NDA4MDIsImV4cCI6MjA4MDAxNjgwMn0.P4a17PQ7i1ZgUvLnFdQGupOtKxx8-CWvPhIaFOl2i7g',
  updateManifestUrl: 'https://raw.githubusercontent.com/CarmaNayeli/rollCloud/main/updates/update_manifest.xml'
};

let mainWindow;

/**
 * Check if installer version matches the latest GitHub release
 * Shows a warning dialog if versions don't match
 */
async function checkVersionMismatch() {
  return new Promise((resolve) => {
    const options = {
      name: 'RollCloud Installation Wizard',
      hostname: 'api.github.com',
      path: '/repos/CarmaNayeli/rollCloud/releases/latest',
      headers: {
        'User-Agent': 'RollCloud-Installer'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name?.replace(/^v/, '') || null;

          if (latestVersion && latestVersion !== INSTALLER_VERSION) {
            console.log(`⚠️ Version mismatch: Installer v${INSTALLER_VERSION}, GitHub v${latestVersion}`);

            dialog.showMessageBox({
              type: 'warning',
              title: 'Installer Version Mismatch',
              message: `This installer (v${INSTALLER_VERSION}) doesn't match the latest release (v${latestVersion}).\n\nPlease open a GitHub issue or contact Carmabella on Discord - they probably forgot to update the installer! 😅`,
              buttons: ['Continue Anyway', 'Close'],
              defaultId: 0,
              cancelId: 1
            }).then(result => {
              if (result.response === 1) {
                app.quit();
                resolve(false);
              } else {
                resolve(true);
              }
            });
          } else {
            console.log(`✅ Installer version matches: v${INSTALLER_VERSION}`);
            resolve(true);
          }
        } catch (e) {
          console.log('⚠️ Could not check version (offline or API error)');
          resolve(true); // Continue anyway if we can't check
        }
      });
    }).on('error', () => {
      console.log('⚠️ Could not check version (network error)');
      resolve(true); // Continue anyway if network fails
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const shouldContinue = await checkVersionMismatch();
  if (shouldContinue) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============================================================================
// IPC Handlers
// ============================================================================

// Get system info
ipcMain.handle('get-system-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    isAdmin: process.platform === 'win32' ? await checkWindowsAdmin() : process.getuid() === 0
  };
});

// Get updater installation info from command line
ipcMain.handle('get-updater-info', async () => {
  const args = process.argv.slice(1);
  const updaterInstalled = args.includes('--updater-installed');
  let updaterDir = null;

  // Find --updater-dir argument
  const updaterDirArg = args.find(arg => arg.startsWith('--updater-dir='));
  if (updaterDirArg) {
    updaterDir = updaterDirArg.split('=')[1].replace(/"/g, '');
  }

  return {
    installed: updaterInstalled,
    directory: updaterDir
  };
});

// Check if extension is already installed
ipcMain.handle('check-extension-installed', async (event, browser) => {
  return await isExtensionInstalled(browser);
});

// Install extension via enterprise policy
ipcMain.handle('install-extension', async (event, browser) => {
  try {
    const result = await installExtension(browser, CONFIG);
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Install Firefox Developer Edition
ipcMain.handle('install-firefox-dev-edition', async () => {
  try {
    const result = await installFirefoxDeveloperEdition();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Uninstall extension (remove policy)
ipcMain.handle('uninstall-extension', async (event, browser) => {
  try {
    await uninstallExtension(browser);
    return { success: true, message: `The ${browser} extension has been removed. Restart your browser to complete the uninstall.` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open Discord bot invite
ipcMain.handle('open-discord-invite', async () => {
  await shell.openExternal(CONFIG.pip2InviteUrl);
  return { success: true };
});

// Generate pairing code
ipcMain.handle('generate-pairing-code', async () => {
  const code = generatePairingCode();
  return { success: true, code };
});

// Create pairing in Supabase
ipcMain.handle('create-pairing', async (event, code) => {
  try {
    await createPairing(code, CONFIG);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create pairing and send to extension (new integrated flow)
ipcMain.handle('create-pairing-and-send', async (event, browser) => {
  try {
    const result = await createPairingAndSend(browser, CONFIG);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if pairing is complete
ipcMain.handle('check-pairing', async (event, code) => {
  try {
    const result = await checkPairing(code, CONFIG);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Send pairing code to extension (no longer needed - extension polls Supabase)
ipcMain.handle('send-pairing-to-extension', async (event, browser, code) => {
  // Native messaging removed - extension now polls Supabase for pairing codes
  return { success: true, message: 'Pairing code stored in Supabase for extension to poll' };
});

// Open external URL
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// Quit app
ipcMain.handle('quit-app', async () => {
  app.quit();
});

// Install updater utility
ipcMain.handle('install-updater', async () => {
  try {
    const result = await installUpdaterUtility();
    return { success: true, message: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Launch updater utility
ipcMain.handle('launch-updater', async () => {
  try {
    const { spawn } = require('child_process');

    // Get updater directory from command line args
    const args = process.argv.slice(1);
    const updaterDirArg = args.find(arg => arg.startsWith('--updater-dir='));
    let updaterPath;

    if (updaterDirArg) {
      const updaterDir = updaterDirArg.split('=')[1].replace(/"/g, '');
      updaterPath = path.join(updaterDir, 'RollCloud-Updater.exe');
    } else {
      // Fallback to default path
      updaterPath = path.join('C:', 'Program Files', 'RollCloud', 'RollCloud-Updater.exe');
    }

    console.log('Attempting to launch updater at:', updaterPath);

    if (fs.existsSync(updaterPath)) {
      // Use spawn with detached to launch updater independently
      const child = spawn(updaterPath, [], {
        detached: true,
        stdio: 'ignore'
      });

      // Unref so wizard can close without waiting for updater
      child.unref();

      console.log('Updater launched successfully');
      return { success: true };
    } else {
      console.error('Updater not found at:', updaterPath);
      throw new Error('Updater not found at: ' + updaterPath);
    }
  } catch (error) {
    console.error('Failed to launch updater:', error);
    return { success: false, error: error.message };
  }
});

// Launch the RollCloud Wizard if present (best-effort)
ipcMain.handle('launch-wizard', async () => {
  try {
    const { exec } = require('child_process');
    // Common install locations - try Program Files first, then resources
    const candidates = [
      path.join('C:', 'Program Files', 'RollCloud', 'RollCloudWizard.exe'),
      path.join(process.resourcesPath || __dirname, '..', 'resources', 'RollCloudWizard.exe')
    ];

    const found = candidates.find(p => fs.existsSync(p));
    if (!found) throw new Error('RollCloud Wizard executable not found');

    exec(`"${found}"`, (error) => {
      if (error) console.error('Failed to launch RollCloud Wizard:', error);
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Install updater utility to Program Files
async function installUpdaterUtility(options = {}) {
  const { execSync } = require('child_process');

  try {
    const installDir = options.installDir || 'programfiles';
    const minimizeToTray = options.minimizeToTray !== false;
    const startWithWindows = options.startWithWindows !== false;

    let targetDir;

    // Determine installation directory
    if (installDir === 'appdata') {
      targetDir = path.join(os.homedir(), 'AppData', 'Local', 'RollCloud');
    } else if (typeof installDir === 'string' && installDir.includes(':')) {
      // Custom full path
      targetDir = installDir;
    } else {
      // Default to Program Files
      targetDir = path.join('C:', 'Program Files', 'RollCloud');
    }

    // Create installation directory
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Get updater from extraResources (packaged with installer)
    const updaterSource = process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '..', 'resources', 'RollCloud-Updater.exe')
      : path.join(process.resourcesPath, 'RollCloud-Updater.exe');

    const updaterDest = path.join(targetDir, 'RollCloud-Updater.exe');

    // Copy updater executable
    if (fs.existsSync(updaterSource)) {
      fs.copyFileSync(updaterSource, updaterDest);
      console.log('✅ Copied updater to:', targetDir);
    } else {
      // If not found in resources, try to build path relative to installer directory
      const altSource = path.join(__dirname, '..', 'updater', 'dist', 'RollCloud-Updater.exe');
      if (fs.existsSync(altSource)) {
        fs.copyFileSync(altSource, updaterDest);
        console.log('✅ Copied updater from alt path to:', targetDir);
      } else {
        throw new Error('Updater executable not found in package resources');
      }
    }

    // Create settings file for the updater with user preferences
    const settingsPath = path.join(targetDir, 'updater-settings.json');
    const settings = {
      minimizeToTray: minimizeToTray,
      startMinimized: minimizeToTray,
      enabled: true,
      checkInterval: 3600000 // 1 hour
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('✅ Created updater settings');

    // Create Start Menu shortcut using PowerShell
    const startMenuDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcutPath = path.join(startMenuDir, 'RollCloud Updater.lnk');

    try {
      // Use PowerShell to create a proper .lnk shortcut
      const psScript = `
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
        $Shortcut.TargetPath = "${updaterDest.replace(/\\/g, '\\\\')}"
        $Shortcut.WorkingDirectory = "${targetDir.replace(/\\/g, '\\\\')}"
        $Shortcut.Description = "RollCloud Updater - Check for extension updates"
        $Shortcut.Save()
      `;
      execSync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { stdio: 'pipe' });
      console.log('✅ Created Start Menu shortcut');
    } catch (shortcutError) {
      console.warn('⚠️ Could not create Start Menu shortcut:', shortcutError.message);
    }

    // Add to Windows startup if requested
    if (startWithWindows) {
      try {
        const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const startupShortcutPath = path.join(startupDir, 'RollCloud Updater.lnk');

        const psStartupScript = `
          $WshShell = New-Object -ComObject WScript.Shell
          $Shortcut = $WshShell.CreateShortcut("${startupShortcutPath.replace(/\\/g, '\\\\')}")
          $Shortcut.TargetPath = "${updaterDest.replace(/\\/g, '\\\\')}"
          $Shortcut.WorkingDirectory = "${targetDir.replace(/\\/g, '\\\\')}"
          $Shortcut.Arguments = "--minimized"
          $Shortcut.Description = "RollCloud Updater - Auto-start"
          $Shortcut.Save()
        `;
        execSync(`powershell -Command "${psStartupScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { stdio: 'pipe' });
        console.log('✅ Added to Windows startup');
      } catch (startupError) {
        console.warn('⚠️ Could not add to startup:', startupError.message);
      }
    }

    return `RollCloud Updater installed successfully to ${targetDir}!`;
  } catch (error) {
    throw new Error(`Failed to install updater: ${error.message}`);
  }
}

// Install updater utility with directory parameter
ipcMain.handle('install-updater-with-directory', async (event, installDir) => {
  try {
    const result = await installUpdaterUtility({ installDir });
    return { success: true, message: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Install updater utility with full options
ipcMain.handle('install-updater-with-options', async (event, options) => {
  try {
    const result = await installUpdaterUtility(options);
    return { success: true, message: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check for extension updates
ipcMain.handle('check-for-updates', async (event, browser) => {
  try {
    const { checkForUpdates } = require('./extension-installer');
    const result = await checkForUpdates(browser, CONFIG);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Update extension
ipcMain.handle('update-extension', async (event, browser) => {
  try {
    const { updateExtension } = require('./extension-installer');
    const result = await updateExtension(browser, CONFIG);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Force reinstall extension
ipcMain.handle('force-reinstall-extension', async (event, browser) => {
  try {
    const { forceReinstallExtension } = require('./extension-installer');
    const result = await forceReinstallExtension(browser, CONFIG);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Restart browser to apply extension policy
ipcMain.handle('restart-browser', async (event, browser) => {
  try {
    const result = await restartBrowser(browser);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// Close browser for restart
// ipcMain.handle('close-browser', async (event, browser) => {
//   try {
//     const { exec } = require('child_process');
//     
//     if (browser === 'firefox') {
//       if (process.platform === 'win32') {
//         // Try multiple methods to close Firefox
//         const commands = [
//           'taskkill /f /im firefox.exe',
//           'taskkill /f /im firefox-dev.exe',
//           'taskkill /f /im "Mozilla Firefox"',
//           'taskkill /f /im "Firefox Developer Edition"'
//         ];
//         
//         let browserClosed = false;
//         for (const cmd of commands) {
//           try {
//             exec(cmd, { stdio: 'pipe' });
//             console.log(`✅ Firefox closed with: ${cmd}`);
//             browserClosed = true;
//             break;
//           } catch (error) {
//             // Check if the error is because the process wasn't found (browser not running)
//             if (error.message.includes('not found') || error.message.includes('ERROR: The process') && error.message.includes('not found')) {
//               console.log(`Firefox not running (checked with ${cmd})`);
//               browserClosed = true; // Consider this a success since browser isn't running
//               break;
//             }
//             console.log(`Failed to close Firefox with ${cmd}:`, error.message);
//           }
//         }
//         
//         if (!browserClosed) {
//           throw new Error('Could not close Firefox with any method');
//         }
//       } else if (process.platform === 'darwin') {
//         const commands = [
//           'pkill -f "Firefox Developer Edition"',
//           'pkill -f firefox',
//           'osascript -e \'tell application "Firefox Developer Edition" to quit\'',
//           'osascript -e \'tell application "Firefox" to quit\''
//         ];
//         
//         let browserClosed = false;
//         for (const cmd of commands) {
//           try {
//             exec(cmd, { stdio: 'pipe' });
//             console.log(`✅ Firefox closed with: ${cmd}`);
//             browserClosed = true;
//             break;
//           } catch (error) {
//             console.log(`Failed to close Firefox with ${cmd}:`, error.message);
//           }
//         }
//         
//         if (!browserClosed) {
//           throw new Error('Could not close Firefox with any method');
//         }
//       } else {
//         exec('pkill -f firefox', (error) => {
//           if (error) {
//             console.log('Could not close Firefox:', error.message);
//           }
//         });
//       }
//     } else if (browser === 'chrome') {
//       if (process.platform === 'win32') {
//         const commands = [
//           'taskkill /f /im chrome.exe',
//           'taskkill /f /im "Google Chrome"',
//           'taskkill /f /im "Google Chrome Canary"',
//           'taskkill /f /im "Google Chrome Beta"'
//         ];
//         
//         let browserClosed = false;
//         for (const cmd of commands) {
//           try {
//             exec(cmd, { stdio: 'pipe' });
//             console.log(`✅ Chrome closed with: ${cmd}`);
//             browserClosed = true;
//             break;
//           } catch (error) {
//             // Check if the error is because the process wasn't found (browser not running)
//             if (error.message.includes('not found') || error.message.includes('ERROR: The process') && error.message.includes('not found')) {
//               console.log(`Chrome not running (checked with ${cmd})`);
//               browserClosed = true; // Consider this a success since browser isn't running
//               break;
//             }
//             console.log(`Failed to close Chrome with ${cmd}:`, error.message);
//           }
//         }
//         
//         if (!browserClosed) {
//           throw new Error('Could not close Chrome with any method');
//         }
//       } else if (process.platform === 'darwin') {
//         const commands = [
//           'osascript -e \'tell application "Google Chrome" to quit\'',
//           'pkill -f "Google Chrome"'
//         ];
//         
//         let browserClosed = false;
//         for (const cmd of commands) {
//           try {
//             exec(cmd, { stdio: 'pipe' });
//             console.log(`✅ Chrome closed with: ${cmd}`);
//             browserClosed = true;
//             break;
//           } catch (error) {
//             console.log(`Failed to close Chrome with ${cmd}:`, error.message);
//           }
//         }
//         
//         if (!browserClosed) {
//           throw new Error('Could not close Chrome with any method');
//         }
//       } else {
//         exec('pkill -f chrome', (error) => {
//           if (error) {
//             console.log('Could not close Chrome:', error.message);
//           }
//         });
//       }
//     }
//     
//     return { success: true };
//   } catch (error) {
//     console.error('Error closing browser:', error);
//     return { success: false, error: error.message };
//   }
// });

// ============================================================================
// Utilities
// ============================================================================

async function checkWindowsAdmin() {
  if (process.platform !== 'win32') return false;

  try {
    const { execSync } = require('child_process');
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
