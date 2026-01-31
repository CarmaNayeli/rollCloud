/**
 * Extension Installer Module
 * Handles enterprise policy installation for Chrome/Firefox on Windows/macOS/Linux
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Browser-specific configuration
const BROWSER_CONFIG = {
  chrome: {
    name: 'Google Chrome',
    windows: {
      registryPath: 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist',
      registryPath32on64: 'HKLM\\SOFTWARE\\WOW6432Node\\Policies\\Google\\Chrome\\ExtensionInstallForcelist'
    },
    mac: {
      plistPath: '/Library/Managed Preferences/com.google.Chrome.plist',
      plistKey: 'ExtensionInstallForcelist'
    },
    linux: {
      jsonPath: '/etc/opt/chrome/policies/managed/rollcloud.json',
      jsonKey: 'ExtensionInstallForcelist'
    }
  },
  firefox: {
    name: 'Mozilla Firefox',
    // Firefox uses a different mechanism - distribution folder
    windows: {
      distributionPath: null // Detected at runtime
    },
    mac: {
      distributionPath: '/Applications/Firefox.app/Contents/Resources/distribution'
    },
    linux: {
      distributionPath: '/usr/lib/firefox/distribution'
    }
  }
};

/**
 * Install extension via enterprise policy
 */
async function installExtension(browser, config) {
  const platform = process.platform;

  if (browser === 'firefox') {
    return await installFirefoxExtension(config);
  }

  // Chrome uses similar policy mechanisms
  const browserConfig = BROWSER_CONFIG[browser];
  if (!browserConfig) {
    throw new Error(`Unsupported browser: ${browser}`);
  }

  // Use browser-specific update URL
  let updateUrl;
  if (browser === 'chrome') {
    updateUrl = config.chromeUpdateUrl || config.updateManifestUrl;
  } else {
    updateUrl = config.firefoxUpdateUrl;
  }

  const policyValue = `${config.extensionId};${updateUrl}`;

  switch (platform) {
    case 'win32':
      return await installWindowsPolicy(browser, policyValue, browserConfig);
    case 'darwin':
      return await installMacPolicy(browser, policyValue, browserConfig);
    case 'linux':
      return await installLinuxPolicy(browser, policyValue, browserConfig);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Windows: Write registry key for Chrome
 */
async function installWindowsPolicy(browser, policyValue, browserConfig) {
  const regPath = browserConfig.windows.registryPath;
  const extensionId = policyValue.split(';')[0];

  // Check if extension is already in the forcelist (avoid duplicates)
  let index = 1;
  let alreadyExists = false;
  try {
    const result = execSync(`reg query "${regPath}" 2>nul`, { encoding: 'utf-8' });
    const lines = result.split('\n').filter(l => l.includes('REG_SZ'));
    for (const line of lines) {
      if (line.includes(extensionId)) {
        // Already exists - find its value name to overwrite it
        const match = line.trim().match(/^(\S+)/);
        if (match) {
          index = match[1];
          alreadyExists = true;
        }
        break;
      }
    }
    if (!alreadyExists) {
      index = lines.length + 1;
    }
  } catch {
    // Key doesn't exist, will be created
  }

  // Build all commands: forcelist entry + install sources to allow GitHub downloads
  const forcelistCmd = `reg add "${regPath}" /v "${index}" /t REG_SZ /d "${policyValue}" /f`;
  const sourcesRegPath = 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallSources';
  const sourcesCmd1 = `reg add "${sourcesRegPath}" /v "1" /t REG_SZ /d "https://github.com/CarmaNayeli/rollCloud/*" /f`;
  const sourcesCmd2 = `reg add "${sourcesRegPath}" /v "2" /t REG_SZ /d "https://raw.githubusercontent.com/CarmaNayeli/rollCloud/*" /f`;
  const allCmds = `${forcelistCmd} && ${sourcesCmd1} && ${sourcesCmd2}`;

  return new Promise((resolve, reject) => {
    exec(allCmds, (error, stdout, stderr) => {
      if (error) {
        // Try with elevated privileges using sudo-prompt
        const sudo = require('sudo-prompt');
        const options = { name: 'RollCloud Installation Wizard' };

        sudo.exec(allCmds, options, (sudoError, sudoStdout, sudoStderr) => {
          if (sudoError) {
            reject(new Error(`Failed to write registry: ${sudoError.message}`));
          } else {
            resolve({ message: 'Extension policy installed (elevated)', requiresRestart: true });
          }
        });
      } else {
        resolve({ message: 'Extension policy installed', requiresRestart: true });
      }
    });
  });
}

/**
 * macOS: Write plist file for Chrome
 */
async function installMacPolicy(browser, policyValue, browserConfig) {
  const plistPath = browserConfig.mac.plistPath;
  const plistKey = browserConfig.mac.plistKey;

  // Create the directory if it doesn't exist
  const dir = path.dirname(plistPath);

  // Read existing plist or create new one
  let plistContent = {};
  if (fs.existsSync(plistPath)) {
    try {
      const result = execSync(`plutil -convert json -o - "${plistPath}"`, { encoding: 'utf-8' });
      plistContent = JSON.parse(result);
    } catch {
      // Plist might be binary or invalid, start fresh
    }
  }

  // Add our extension to the forcelist
  if (!plistContent[plistKey]) {
    plistContent[plistKey] = [];
  }
  if (!plistContent[plistKey].includes(policyValue)) {
    plistContent[plistKey].push(policyValue);
  }

  // Add install sources to allow downloads from GitHub
  if (!plistContent['ExtensionInstallSources']) {
    plistContent['ExtensionInstallSources'] = [];
  }
  const githubSources = [
    'https://github.com/CarmaNayeli/rollCloud/*',
    'https://raw.githubusercontent.com/CarmaNayeli/rollCloud/*'
  ];
  for (const source of githubSources) {
    if (!plistContent['ExtensionInstallSources'].includes(source)) {
      plistContent['ExtensionInstallSources'].push(source);
    }
  }

  // Write the plist
  const tempFile = path.join(os.tmpdir(), 'rollcloud-policy.json');
  fs.writeFileSync(tempFile, JSON.stringify(plistContent, null, 2));

  const commands = [
    `mkdir -p "${dir}"`,
    `plutil -convert xml1 "${tempFile}" -o "${plistPath}"`,
    `rm "${tempFile}"`
  ].join(' && ');

  return new Promise((resolve, reject) => {
    const sudo = require('sudo-prompt');
    const options = { name: 'RollCloud Installation Wizard' };

    sudo.exec(commands, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Failed to write plist: ${error.message}`));
      } else {
        resolve({ message: 'Extension policy installed', requiresRestart: true });
      }
    });
  });
}

/**
 * Linux: Write JSON policy file for Chrome
 */
async function installLinuxPolicy(browser, policyValue, browserConfig) {
  const jsonPath = browserConfig.linux.jsonPath;
  const jsonKey = browserConfig.linux.jsonKey;
  const dir = path.dirname(jsonPath);

  // Read existing policy or create new one
  let policyContent = {};
  if (fs.existsSync(jsonPath)) {
    try {
      policyContent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Add our extension to the forcelist
  if (!policyContent[jsonKey]) {
    policyContent[jsonKey] = [];
  }
  if (!policyContent[jsonKey].includes(policyValue)) {
    policyContent[jsonKey].push(policyValue);
  }

  // Add install sources to allow downloads from GitHub
  if (!policyContent['ExtensionInstallSources']) {
    policyContent['ExtensionInstallSources'] = [];
  }
  const githubSources = [
    'https://github.com/CarmaNayeli/rollCloud/*',
    'https://raw.githubusercontent.com/CarmaNayeli/rollCloud/*'
  ];
  for (const source of githubSources) {
    if (!policyContent['ExtensionInstallSources'].includes(source)) {
      policyContent['ExtensionInstallSources'].push(source);
    }
  }

  // Write to temp file first
  const tempFile = path.join(os.tmpdir(), 'rollcloud-policy.json');
  fs.writeFileSync(tempFile, JSON.stringify(policyContent, null, 2));

  const commands = [
    `mkdir -p "${dir}"`,
    `cp "${tempFile}" "${jsonPath}"`,
    `chmod 644 "${jsonPath}"`,
    `rm "${tempFile}"`
  ].join(' && ');

  return new Promise((resolve, reject) => {
    exec(`sudo ${commands}`, (error, stdout, stderr) => {
      if (error) {
        // Try with sudo-prompt for GUI prompt
        const sudo = require('sudo-prompt');
        const options = { name: 'RollCloud Installation Wizard' };

        sudo.exec(commands, options, (sudoError, sudoStdout, sudoStderr) => {
          if (sudoError) {
            reject(new Error(`Failed to write policy: ${sudoError.message}`));
          } else {
            resolve({ message: 'Extension policy installed', requiresRestart: true });
          }
        });
      } else {
        resolve({ message: 'Extension policy installed', requiresRestart: true });
      }
    });
  });
}

/**
 * Check if Firefox Developer Edition is installed
 * Returns the path to firefox.exe if found, null otherwise
 */
function findFirefoxDeveloperEdition() {
  const platform = process.platform;

  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const paths = [
      path.join(programFiles, 'Firefox Developer Edition', 'firefox.exe'),
      path.join(programFiles86, 'Firefox Developer Edition', 'firefox.exe')
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(`   ✅ Found Firefox Developer Edition: ${p}`);
        return p;
      }
    }
  } else if (platform === 'darwin') {
    const devPath = '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox';
    if (fs.existsSync(devPath)) {
      return devPath;
    }
  } else {
    // Linux - check for firefox-developer-edition or firefox-devedition
    try {
      execSync('which firefox-developer-edition', { stdio: 'pipe' });
      return 'firefox-developer-edition';
    } catch {
      try {
        execSync('which firefox-devedition', { stdio: 'pipe' });
        return 'firefox-devedition';
      } catch {
        // Not found
      }
    }
  }

  return null;
}

/**
 * Check if Firefox is currently running
 */
function isFirefoxRunning() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      const result = execSync('tasklist /FI "IMAGENAME eq firefox.exe" /NH', { encoding: 'utf-8', stdio: 'pipe' });
      return result.toLowerCase().includes('firefox.exe');
    } else if (platform === 'darwin') {
      const result = execSync('pgrep -x firefox', { encoding: 'utf-8', stdio: 'pipe' });
      return result.trim().length > 0;
    } else {
      const result = execSync('pgrep -x firefox', { encoding: 'utf-8', stdio: 'pipe' });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}

/**
 * Launch Firefox with an optional URL/file
 */
function launchFirefox(firefoxPath, fileToOpen = null) {
  const platform = process.platform;

  try {
    let command;
    if (platform === 'win32') {
      command = fileToOpen
        ? `start "" "${firefoxPath}" "${fileToOpen}"`
        : `start "" "${firefoxPath}"`;
    } else if (platform === 'darwin') {
      command = fileToOpen
        ? `open -a "Firefox Developer Edition" "${fileToOpen}"`
        : `open -a "Firefox Developer Edition"`;
    } else {
      command = fileToOpen
        ? `${firefoxPath} "${fileToOpen}" &`
        : `${firefoxPath} &`;
    }

    exec(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error('   Failed to launch Firefox:', error.message);
    return false;
  }
}

/**
 * Wait for Firefox Developer Edition to be installed and available
 */
async function waitForFirefoxInstallation() {
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const checkInterval = 3000; // Check every 3 seconds
  const startTime = Date.now();
  
  console.log('   ⏳ Waiting for Firefox Developer Edition installation...');
  
  return new Promise((resolve) => {
    const checkInstallation = () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed > maxWaitTime) {
        console.log('   ⏱️ Timeout waiting for Firefox installation');
        resolve({
          success: false,
          timeout: true,
          message: 'Installation timeout. Please complete the installation manually and click Retry.'
        });
        return;
      }
      
      // Check if Firefox Developer Edition is now installed
      const firefoxPath = findFirefoxDeveloperEdition();
      
      if (firefoxPath) {
        console.log('   ✅ Firefox Developer Edition found at:', firefoxPath);
        
        // Check if it's actually running (installer might still be running)
        const isRunning = isFirefoxRunning();
        
        if (isRunning) {
          console.log('   ✅ Firefox Developer Edition is running');
          resolve({
            success: true,
            firefoxPath,
            isRunning: true,
            message: 'Firefox Developer Edition installed and running successfully!'
          });
        } else {
          console.log('   🔍 Firefox found but not running yet, checking again...');
          setTimeout(checkInstallation, checkInterval);
        }
      } else {
        // Still not installed, continue waiting
        const remainingTime = Math.max(0, Math.ceil((maxWaitTime - elapsed) / 1000));
        console.log(`   ⏳ Still waiting... (${Math.floor(remainingTime / 60)}:${(remainingTime % 60).toString().padStart(2, '0')} remaining)`);
        setTimeout(checkInstallation, checkInterval);
      }
    };
    
    // Start checking
    setTimeout(checkInstallation, 2000); // Wait 2 seconds before first check
  });
}

/**
 * Install Firefox Developer Edition from bundled stub installer
 */
async function installFirefoxDeveloperEdition() {
  try {
    console.log('   Installing Firefox Developer Edition from bundled installer...');

    // Path to the bundled installer - check both dev and production paths
    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev') || !process.resourcesPath;
    let installerPath;

    if (isDev) {
      // Development: installer is in assets folder
      installerPath = path.join(__dirname, '..', 'assets', 'FirefoxDeveloperEdition.exe');
    } else {
      // Production: installer is in extraResources
      installerPath = path.join(process.resourcesPath, 'installers', 'FirefoxDeveloperEdition.exe');
    }

    console.log(`   Looking for installer at: ${installerPath}`);

    if (!fs.existsSync(installerPath)) {
      // Fallback: try the other path
      const fallbackPath = isDev
        ? path.join(process.resourcesPath || '', 'installers', 'FirefoxDeveloperEdition.exe')
        : path.join(__dirname, '..', 'assets', 'FirefoxDeveloperEdition.exe');

      console.log(`   Trying fallback path: ${fallbackPath}`);

      if (fs.existsSync(fallbackPath)) {
        installerPath = fallbackPath;
      } else {
        // Only open download page as last resort if installer is missing
        const { shell } = require('electron');
        await shell.openExternal('https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org');
        return {
          success: false,
          openedDownloadPage: true,
          downloadUrl: 'https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org',
          message: 'Bundled installer not found. Download page opened instead.'
        };
      }
    }

    console.log(`   Using bundled installer: ${installerPath}`);

    // Execute the installer directly with proper Windows handling
    const { spawn, exec } = require('child_process');

    return new Promise((resolve, reject) => {
      console.log('   Executing Firefox Developer Edition installer...');
      
      // Method 1: Use exec with proper Windows command execution
      const execCmd = `"${installerPath}"`;
      
      exec(execCmd, {
        cwd: path.dirname(installerPath),
        timeout: 15000, // 15 second timeout to allow installer to start
        windowsHide: false
      }, (error, stdout, stderr) => {
        if (error) {
          console.log('   Exec returned (expected for GUI installer):', error.code || error.message);
          
          // For GUI installers, the process often returns immediately while the installer continues
          // This is normal behavior, so we consider it successful
          if (error.code === 0 || error.signal === null) {
            console.log('   Installer appears to be running');
            
            // Start waiting for installation to complete
            waitForFirefoxInstallation().then((waitResult) => {
              if (waitResult.success) {
                resolve({
                  success: true,
                  installing: false,
                  completed: true,
                  firefoxPath: waitResult.firefoxPath,
                  message: 'Firefox Developer Edition installed successfully!'
                });
              } else {
                resolve({
                  success: true,
                  installing: true,
                  waiting: true,
                  message: waitResult.message || 'Please complete the Firefox installation and click Retry.'
                });
              }
            });
            
          } else {
            // Method 2: Try spawn with detached execution
            console.log('   Trying spawn method...');
            
            try {
              const installer = spawn(installerPath, [], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false, // Don't use shell to avoid extra processes
                windowsHide: false,
                cwd: path.dirname(installerPath),
                env: { ...process.env }
              });

              installer.on('error', (spawnError) => {
                console.error('   Spawn error:', spawnError);
                reject(new Error(`Failed to launch installer: ${spawnError.message}`));
              });

              installer.on('spawn', () => {
                console.log('   Installer spawned successfully');
                installer.unref(); // Allow parent to exit
                
                // Start waiting for installation to complete
                waitForFirefoxInstallation().then((waitResult) => {
                  if (waitResult.success) {
                    resolve({
                      success: true,
                      installing: false,
                      completed: true,
                      firefoxPath: waitResult.firefoxPath,
                      message: 'Firefox Developer Edition installed successfully!'
                    });
                  } else {
                    resolve({
                      success: true,
                      installing: true,
                      waiting: true,
                      message: waitResult.message || 'Please complete the Firefox installation and click Retry.'
                    });
                  }
                });
              });

              // Timeout fallback
              setTimeout(() => {
                if (!installer.killed) {
                  console.log('   Installer running (timeout reached)');
                  installer.unref();
                  
                  // Start waiting for installation to complete
                  waitForFirefoxInstallation().then((waitResult) => {
                    if (waitResult.success) {
                      resolve({
                        success: true,
                        installing: false,
                        completed: true,
                        firefoxPath: waitResult.firefoxPath,
                        message: 'Firefox Developer Edition installed successfully!'
                      });
                    } else {
                      resolve({
                        success: true,
                        installing: true,
                        waiting: true,
                        message: waitResult.message || 'Please complete the Firefox installation and click Retry.'
                      });
                    }
                  });
                }
              }, 3000);

            } catch (spawnError) {
              console.error('   Spawn failed:', spawnError);
              reject(new Error(`Failed to launch installer: ${spawnError.message}`));
            }
          }
        } else {
          console.log('   Exec completed successfully');
          
          // Start waiting for installation to complete
          waitForFirefoxInstallation().then((waitResult) => {
            if (waitResult.success) {
              resolve({
                success: true,
                installing: false,
                completed: true,
                firefoxPath: waitResult.firefoxPath,
                message: 'Firefox Developer Edition installed successfully!'
              });
            } else {
              resolve({
                success: true,
                installing: true,
                waiting: true,
                message: waitResult.message || 'Please complete the Firefox installation and click Retry.'
              });
            }
          });
        }
      });

    });

  } catch (error) {
    console.error('   Failed to install Firefox Developer Edition:', error);

    // Fallback: open download page
    try {
      const { shell } = require('electron');
      await shell.openExternal('https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org');
    } catch (e) {
      // Ignore
    }

    return {
      success: false,
      error: error.message,
      openedDownloadPage: true,
      downloadUrl: 'https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org',
      message: `Installation failed: ${error.message}. Download page opened.`
    };
  }
}
/**
 * Install Firefox Extension with proper flow:
 * 1. Check if Firefox Developer Edition is installed
 * 2. If not, install it
 * 3. Check if Firefox is running
 * 4. If not, open it
 * 5. Send the extension to Firefox for installation
 */
async function installFirefoxExtension(config) {
  try {
    const crypto = require('crypto');
    const platform = process.platform;

    console.log('\n🦊 Starting Firefox extension installation...');
    console.log(`   Platform: ${platform}`);

    // ========================================================================
    // Step 1: Check if Firefox Developer Edition is installed
    // ========================================================================
    console.log('\n   Step 1: Checking for Firefox Developer Edition...');
    let firefoxPath = findFirefoxDeveloperEdition();

    // ========================================================================
    // Step 2: If not installed, install it using the bundled installer
    // ========================================================================
    if (!firefoxPath) {
      console.log('   Firefox Developer Edition not found.');
      console.log('\n   Step 2: Installing Firefox Developer Edition...');

      // Call the installer function directly
      const installResult = await installFirefoxDeveloperEdition();
      
      if (installResult.success) {
        if (installResult.completed) {
          // Installation completed successfully, continue with extension installation
          console.log('   ✅ Firefox Developer Edition installation completed');
          // Re-detect Firefox path after installation
          firefoxPath = findFirefoxDeveloperEdition();
          if (!firefoxPath) {
            return {
              success: false,
              message: 'Firefox Developer Edition was installed but could not be found. Please restart the installer.'
            };
          }
        } else {
          // Still installing/waiting
          return {
            message: installResult.message || 'Firefox Developer Edition installation in progress.',
            requiresRestart: false,
            requiresManualAction: true,
            manualInstructions: {
              type: 'firefox_installation',
              steps: [
                '1. Firefox Developer Edition installer is now running',
                '2. Complete the installation wizard',
                '3. Click "Retry Installation" when finished'
              ]
            }
          };
        }
      } else {
        return installResult;
      }
    } else {
      console.log('   ✅ Firefox Developer Edition already installed');
    }

    // ========================================================================
    // Step 3: Locate the XPI file
    // ========================================================================
    console.log('\n   Step 3: Locating extension XPI file...');

    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev') || !process.resourcesPath;
    let localXpiPath;

    console.log(`   Development mode: ${isDev}`);
    console.log(`   __dirname: ${__dirname}`);
    console.log(`   process.resourcesPath: ${process.resourcesPath}`);

    if (isDev) {
      localXpiPath = path.join(__dirname, '..', '..', '..', 'dist', 'rollcloud-firefox-signed.xpi');
      console.log(`   Trying dev path: ${localXpiPath}`);
      
      // If the signed version doesn't exist, try the unsigned one
      if (!fs.existsSync(localXpiPath)) {
        localXpiPath = path.join(__dirname, '..', '..', '..', 'dist', 'rollcloud-firefox.xpi');
        console.log(`   Signed not found, trying unsigned: ${localXpiPath}`);
      }
    } else {
      localXpiPath = path.join(process.resourcesPath, 'extension', 'rollcloud-firefox.xpi');
      console.log(`   Trying production path: ${localXpiPath}`);
    }

    if (!fs.existsSync(localXpiPath)) {
      // Try some additional fallback paths
      const fallbackPaths = [
        path.join(__dirname, '..', '..', '..', 'dist', 'rollcloud-firefox-signed.xpi'),
        path.join(__dirname, '..', '..', '..', 'dist', 'rollcloud-firefox.xpi'),
        path.join(__dirname, '..', '..', 'dist', 'rollcloud-firefox-signed.xpi'),
        path.join(__dirname, '..', '..', 'dist', 'rollcloud-firefox.xpi'),
        path.join(process.cwd(), 'dist', 'rollcloud-firefox-signed.xpi'),
        path.join(process.cwd(), 'dist', 'rollcloud-firefox.xpi')
      ];
      
      for (const fallback of fallbackPaths) {
        console.log(`   Trying fallback: ${fallback}`);
        if (fs.existsSync(fallback)) {
          localXpiPath = fallback;
          console.log(`   Found XPI at: ${localXpiPath}`);
          break;
        }
      }
    }

    if (!fs.existsSync(localXpiPath)) {
      throw new Error(`Firefox XPI file not found at: ${localXpiPath}. Tried multiple paths.`);
    }

    // Verify file integrity
    const stats = fs.statSync(localXpiPath);
    console.log(`   XPI file size: ${stats.size} bytes`);

    if (stats.size < 1000) {
      throw new Error(`XPI file appears to be too small (${stats.size} bytes)`);
    }

    // Check for valid ZIP header
    const fileBuffer = fs.readFileSync(localXpiPath);
    const header = fileBuffer.toString('ascii', 0, 2);
    if (header !== 'PK') {
      throw new Error('XPI file is corrupted - invalid ZIP header');
    }

    console.log('   ✅ XPI file validated');

    // ========================================================================
    // Step 4: Configure Firefox for unsigned extensions
    // ========================================================================
    console.log('\n   Step 4: Configuring Firefox for unsigned extensions...');

    // Check if Firefox is running - must be closed to modify prefs.js
    const firefoxIsRunning = isFirefoxRunning();
    if (firefoxIsRunning) {
      console.log('   ⚠️ Firefox is currently running - configuration changes require Firefox to be closed');

      return {
        message: 'Firefox must be closed to configure unsigned extension support',
        requiresRestart: false,
        requiresManualAction: true,
        manualInstructions: {
          type: 'firefox_close_required',
          steps: [
            '1. Please close Firefox completely (File > Exit)',
            '2. Click "Retry Installation" to continue',
            '',
            'Alternative: Enable unsigned extensions manually:',
            '1. Open Firefox and type about:config in the address bar',
            '2. Search for "xpinstall.signatures.required"',
            '3. Set it to "false"',
            '4. Restart Firefox and try installing the extension again'
          ]
        }
      };
    }

    if (platform === 'win32') {
      const appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming');
      const firefoxProfileDir = path.join(appData, 'Mozilla', 'Firefox', 'Profiles');

      if (fs.existsSync(firefoxProfileDir)) {
        const profiles = fs.readdirSync(firefoxProfileDir).filter(f => {
          const fullPath = path.join(firefoxProfileDir, f);
          return fs.statSync(fullPath).isDirectory();
        });

        let configuredProfiles = 0;
        for (const profile of profiles) {
          const prefsPath = path.join(firefoxProfileDir, profile, 'prefs.js');
          try {
            let prefsContent = '';
            if (fs.existsSync(prefsPath)) {
              prefsContent = fs.readFileSync(prefsPath, 'utf8');
            }

            // Remove existing xpinstall settings to avoid duplicates
            prefsContent = prefsContent.split('\n').filter(line =>
              !line.includes('xpinstall.signatures.required') &&
              !line.includes('extensions.langpacks.signatures.required')
            ).join('\n');

            // Add configuration
            prefsContent += '\n// Allow unsigned extensions for owlCloud\n';
            prefsContent += 'user_pref("xpinstall.signatures.required", false);\n';
            prefsContent += 'user_pref("extensions.langpacks.signatures.required", false);\n';

            fs.writeFileSync(prefsPath, prefsContent);
            console.log(`   ✅ Configured profile: ${profile}`);
            configuredProfiles++;
          } catch (prefsError) {
            console.log(`   ⚠️ Could not configure profile ${profile}: ${prefsError.message}`);
          }
        }

        if (configuredProfiles > 0) {
          console.log(`   ✅ Successfully configured ${configuredProfiles} Firefox profile(s)`);
        } else {
          console.log('   ⚠️ No Firefox profiles were configured - manual configuration may be required');
        }
      } else {
        console.log('   ℹ️ No Firefox profiles found - will be configured on first run');
      }
    }

    // ========================================================================
    // Step 5: Check if Firefox is running
    // ========================================================================
    console.log('\n   Step 5: Checking if Firefox is running...');
    const wasRunning = isFirefoxRunning();

    if (wasRunning) {
      console.log('   ✅ Firefox is already running');
    } else {
      console.log('   Firefox is not running, will launch it');
    }

    // ========================================================================
    // Step 6: Open Firefox with the XPI file for installation
    // ========================================================================
    console.log('\n   Step 6: Opening Firefox with extension...');

    // Launch Firefox with the XPI file to trigger installation dialog
    const launched = launchFirefox(firefoxPath, localXpiPath);

    if (launched) {
      console.log('   ✅ Firefox launched with extension file');

      // Give Firefox a moment to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        message: 'Extension policy installed - Firefox opened with extension',
        requiresRestart: false,
        requiresManualAction: true,
        manualInstructions: {
          type: 'firefox_addon',
          steps: [
            '1. Firefox should now show an installation prompt',
            '2. If you see "This add-on could not be verified":',
            '   - This is expected for development builds',
            '   - Click "Add anyway" or "Continue to Installation"',
            '3. Click "Add" to install the owlCloud extension',
            '4. Grant any requested permissions',
            '5. The extension icon should appear in the toolbar',
            '',
            'Troubleshooting:',
            '- If installation is blocked, open about:config in Firefox',
            '- Search for "xpinstall.signatures.required"',
            '- Set it to "false" and retry'
          ],
          xpiPath: localXpiPath
        }
      };
    } else {
      // Fallback: provide manual instructions
      return {
        message: 'Could not launch Firefox automatically.',
        requiresRestart: true,
        requiresManualAction: true,
        manualInstructions: {
          type: 'firefox_addon_manual',
          steps: [
            '1. Open Firefox Developer Edition manually',
            '2. Type about:config in the address bar and press Enter',
            '3. Search for "xpinstall.signatures.required"',
            '4. Set it to "false" (double-click to toggle)',
            '5. Press Ctrl+O (or Cmd+O on Mac) to open a file',
            `6. Navigate to: ${localXpiPath}`,
            '7. If you see "could not be verified", click "Add anyway"',
            '8. Click "Add" to install the extension',
            '9. Grant any requested permissions'
          ],
          xpiPath: localXpiPath
        }
      };
    }

  } catch (error) {
    console.error('   Firefox installation error:', error);
    throw new Error(`Failed to install Firefox extension: ${error.message}`);
  }
}

// Extension IDs for different browsers
const EXTENSION_IDS = {
  chrome: 'mkckngoemfjdkhcpaomdndlecolckgdj', // Actual Chrome extension ID
  firefox: 'rollcloud@dicecat.dev' // Firefox extension ID
};

/**
 * Get Chrome extension ID from the signing key
 */
function getChromeExtensionId() {
  const keysDir = path.join(__dirname, '..', '..', 'keys');
  const idFile = path.join(__dirname, '..', '..', 'dist', 'rollcloud-chrome-signed.id');

  // Try to read pre-generated ID
  if (fs.existsSync(idFile)) {
    return fs.readFileSync(idFile, 'utf8').trim();
  }

  // Fallback: generate from public key if available
  const publicKeyDer = path.join(keysDir, 'public.der');
  if (fs.existsSync(publicKeyDer)) {
    const crypto = require('crypto');
    const keyData = fs.readFileSync(publicKeyDer);
    const hash = crypto.createHash('sha256').update(keyData).digest();
    let result = '';
    for (let i = 0; i < 16; i++) {
      const byte = hash[i];
      result += String.fromCharCode(97 + ((byte >> 4) & 0x0F));
      result += String.fromCharCode(97 + (byte & 0x0F));
    }
    return result.substring(0, 32);
  }

  return null;
}

/**
 * Get browser profile directories where extensions are installed
 */
function getBrowserProfileDirs(browser) {
  const platform = process.platform;
  const home = os.homedir();
  const dirs = [];

  switch (browser) {
    case 'chrome':
      if (platform === 'win32') {
        dirs.push(path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'));
      } else if (platform === 'darwin') {
        dirs.push(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
      } else {
        dirs.push(path.join(home, '.config', 'google-chrome'));
        dirs.push(path.join(home, '.config', 'chromium'));
      }
      break;

    case 'firefox':
      if (platform === 'win32') {
        dirs.push(path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles'));
      } else if (platform === 'darwin') {
        dirs.push(path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles'));
      } else {
        dirs.push(path.join(home, '.mozilla', 'firefox'));
      }
      break;
  }

  return dirs.filter(d => fs.existsSync(d));
}

/**
 * Check if extension is actually installed in browser profile
 */
function checkActualInstallation(browser, extensionId) {
  if (!extensionId) {
    console.log(`  No extension ID available for ${browser}`);
    return false;
  }

  const profileDirs = getBrowserProfileDirs(browser);
  console.log(`  Checking ${browser} profile dirs:`, profileDirs);

  for (const profileDir of profileDirs) {
    if (browser === 'firefox') {
      // Firefox stores extensions in profile/extensions/ as .xpi files or folders
      try {
        const profiles = fs.readdirSync(profileDir).filter(f => {
          const fullPath = path.join(profileDir, f);
          return fs.statSync(fullPath).isDirectory() && f.includes('.default');
        });

        for (const profile of profiles) {
          const extDir = path.join(profileDir, profile, 'extensions');
          if (fs.existsSync(extDir)) {
            // Check for extension folder or xpi file
            const extPath = path.join(extDir, extensionId);
            const xpiPath = path.join(extDir, `${extensionId}.xpi`);
            if (fs.existsSync(extPath) || fs.existsSync(xpiPath)) {
              console.log(`  ✅ Found Firefox extension at: ${fs.existsSync(extPath) ? extPath : xpiPath}`);
              return true;
            }
          }

          // Also check extensions.json for enabled extensions
          const extJsonPath = path.join(profileDir, profile, 'extensions.json');
          if (fs.existsSync(extJsonPath)) {
            try {
              const extJson = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
              const found = extJson.addons?.some(addon =>
                addon.id === extensionId && addon.active && !addon.userDisabled
              );
              if (found) {
                console.log(`  ✅ Found active Firefox extension in extensions.json`);
                return true;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      } catch (e) {
        console.log(`  Error checking Firefox profiles:`, e.message);
      }
    } else {
      // Chrome stores extensions in Default/Extensions/<extension_id>/
      const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
      for (const profile of profiles) {
        const extDir = path.join(profileDir, profile, 'Extensions', extensionId);
        if (fs.existsSync(extDir)) {
          // Check if there's at least one version folder with a manifest.json
          try {
            const versions = fs.readdirSync(extDir);
            for (const version of versions) {
              const versionDir = path.join(extDir, version);
              const manifestPath = path.join(versionDir, 'manifest.json');
              // Only count as installed if manifest.json actually exists
              if (fs.existsSync(manifestPath)) {
                console.log(`  ✅ Found ${browser} extension with manifest at: ${versionDir}`);
                return true;
              }
            }
            // Folder exists but no valid manifest - likely residual/corrupted
            console.log(`  ⚠️ Extension folder exists but no valid manifest found: ${extDir}`);
          } catch (e) {
            // Ignore read errors
          }
        }
        // Note: Removed Preferences check as it's unreliable after uninstall
      }
    }
  }

  return false;
}

/**
 * Check if extension policy is installed (enterprise deployment)
 */
function checkPolicyInstallation(browser) {
  const platform = process.platform;
  const browserConfig = BROWSER_CONFIG[browser];

  if (!browserConfig) return false;

  try {
    if (browser === 'firefox') {
      // Firefox uses policies.json with ExtensionSettings
      let policiesPath;
      if (platform === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        policiesPath = path.join(programFiles, 'Mozilla Firefox', 'distribution', 'policies.json');
      } else if (platform === 'darwin') {
        policiesPath = path.join(browserConfig.mac.distributionPath, 'policies.json');
      } else {
        policiesPath = path.join(browserConfig.linux.distributionPath, 'policies.json');
      }

      if (fs.existsSync(policiesPath)) {
        const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
        // Correct structure: policies.policies.ExtensionSettings
        const extSettings = policies.policies?.ExtensionSettings;
        if (extSettings && extSettings[EXTENSION_IDS.firefox]) {
          console.log(`  ✅ Found Firefox policy for RollCloud`);
          return true;
        }
      }
      return false;
    }

    // Chrome uses registry on Windows, plist on macOS, JSON on Linux
    if (platform === 'win32') {
      const registryPath = browserConfig.windows.registryPath;
      try {
        const result = execSync(`reg query "${registryPath}" 2>nul`, { encoding: 'utf8' });
        // Forcelist entries are strings like "extensionId;updateUrl"
        const extensionId = EXTENSION_IDS.chrome;
        if (extensionId && result.includes(extensionId)) {
          console.log(`  ✅ Found ${browser} registry policy for RollCloud`);
          return true;
        }
      } catch (e) {
        // Registry key doesn't exist
      }
    } else if (platform === 'darwin') {
      const plistPath = browserConfig.mac.plistPath;
      if (fs.existsSync(plistPath)) {
        try {
          const result = execSync(`plutil -convert json -o - "${plistPath}"`, { encoding: 'utf8' });
          const plist = JSON.parse(result);
          const extensionId = EXTENSION_IDS.chrome;
          // Forcelist is array of strings like "extensionId;updateUrl"
          if (extensionId && plist.ExtensionInstallForcelist?.some(e => e.startsWith(extensionId))) {
            console.log(`  ✅ Found ${browser} plist policy for RollCloud`);
            return true;
          }
        } catch (e) {
          // Plist parse error
        }
      }
    } else {
      const jsonPath = browserConfig.linux.jsonPath;
      if (fs.existsSync(jsonPath)) {
        try {
          const policies = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          const extensionId = EXTENSION_IDS.chrome;
          // Forcelist is array of strings
          if (extensionId && policies.ExtensionInstallForcelist?.some(e => e.startsWith(extensionId))) {
            console.log(`  ✅ Found ${browser} policy for RollCloud`);
            return true;
          }
        } catch (e) {
          // JSON parse error
        }
      }
    }

    return false;
  } catch (error) {
    console.log(`  Error checking policy:`, error.message);
    return false;
  }
}

/**
 * Check if extension is installed - checks both actual installation and policies
 */
async function isExtensionInstalled(browser) {
  console.log(`\n🔍 Checking if RollCloud is installed in ${browser}...`);

  const browserConfig = BROWSER_CONFIG[browser];
  if (!browserConfig) {
    console.log(`  ❌ Unsupported browser: ${browser}`);
    return false;
  }

  // Get the appropriate extension ID
  const extensionId = browser === 'firefox'
    ? EXTENSION_IDS.firefox
    : EXTENSION_IDS.chrome; // Use actual Chrome extension ID

  console.log(`  Extension ID: ${extensionId || 'unknown'}`);

  // Check actual browser profile for installed extension
  const actuallyInstalled = checkActualInstallation(browser, extensionId);
  if (actuallyInstalled) {
    console.log(`  ✅ Extension is ACTUALLY INSTALLED in ${browser}`);
    return true;
  }

  // Check if policy is set (pending installation)
  const policySet = checkPolicyInstallation(browser);
  if (policySet) {
    console.log(`  ⚠️ Policy is set but extension not yet installed (browser restart may be needed)`);
    return 'policy_only';
  }

  console.log(`  ❌ Extension is NOT installed in ${browser}`);
  return false;
}

/**
 * Uninstall extension (remove policy)
 */
async function uninstallExtension(browser) {
  try {
    console.log(`\n🗑️ Uninstalling ${browser} extension...`);
    
    if (browser === 'firefox') {
      // For Firefox, we need to remove from policies.json and extension directories
      const platform = process.platform;
      let policiesPath;
      
      if (platform === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        policiesPath = path.join(programFiles, 'Mozilla Firefox', 'distribution', 'policies.json');
      } else if (platform === 'darwin') {
        policiesPath = '/Applications/Firefox.app/Contents/Resources/distribution/policies.json';
      } else {
        policiesPath = '/usr/lib/firefox/distribution/policies.json';
      }

      // Remove from policies.json if it exists
      if (fs.existsSync(policiesPath)) {
        try {
          const policies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
          if (policies.policies?.ExtensionSettings?.[EXTENSION_IDS.firefox]) {
            delete policies.policies.ExtensionSettings[EXTENSION_IDS.firefox];
            
            // Write back the updated policies
            const tempFile = path.join(require('os').tmpdir(), 'rollcloud-policies-backup.json');
            fs.writeFileSync(tempFile, JSON.stringify(policies, null, 2));
            
            const sudo = require('sudo-prompt');
            const options = { name: 'RollCloud Installation Wizard' };
            const commands = `cp "${tempFile}" "${policiesPath}" && rm "${tempFile}"`;
            
            return new Promise((resolve, reject) => {
              sudo.exec(commands, options, (error) => {
                if (error) {
                  console.log('   Could not remove Firefox policy (may require manual removal)');
                  resolve({ success: true, message: 'Extension uninstall initiated. Some components may require manual removal.' });
                } else {
                  console.log('   ✅ Firefox extension policy removed');
                  resolve({ success: true, message: 'Firefox extension uninstalled successfully.' });
                }
              });
            });
          }
        } catch (e) {
          console.log('   Error reading policies file:', e.message);
        }
      }
      
      // Also remove from user profiles
      const profileDirs = getBrowserProfileDirs('firefox');
      for (const profileDir of profileDirs) {
        try {
          const profiles = fs.readdirSync(profileDir).filter(f => {
            const fullPath = path.join(profileDir, f);
            return fs.statSync(fullPath).isDirectory() && f.includes('.default');
          });

          for (const profile of profiles) {
            const extDir = path.join(profileDir, profile, 'extensions', EXTENSION_IDS.firefox);
            const xpiPath = path.join(profileDir, profile, 'extensions', `${EXTENSION_IDS.firefox}.xpi`);
            
            if (fs.existsSync(extDir)) {
              try {
                fs.rmSync(extDir, { recursive: true, force: true });
                console.log(`   ✅ Removed Firefox extension directory: ${extDir}`);
              } catch (e) {
                console.log(`   Could not remove extension directory: ${e.message}`);
              }
            }
            
            if (fs.existsSync(xpiPath)) {
              try {
                fs.unlinkSync(xpiPath);
                console.log(`   ✅ Removed Firefox extension XPI: ${xpiPath}`);
              } catch (e) {
                console.log(`   Could not remove XPI file: ${e.message}`);
              }
            }
          }
        } catch (e) {
          console.log(`   Error checking profile ${profileDir}:`, e.message);
        }
      }
      
      return { success: true, message: 'Firefox extension uninstalled successfully.' };
      
    } else {
      // For Chrome, remove from registry/policy
      const platform = process.platform;
      const browserConfig = BROWSER_CONFIG[browser];

      if (!browserConfig) {
        throw new Error(`Unsupported browser: ${browser}`);
      }

      if (platform === 'win32') {
        const extensionId = EXTENSION_IDS.chrome;

        // Check all possible registry locations
        const registryPaths = [
          // Machine-wide policies
          browserConfig.windows.registryPath,
          browserConfig.windows.registryPath32on64,
          // User-specific policies
          browserConfig.windows.registryPath.replace('HKLM', 'HKCU'),
          browserConfig.windows.registryPath32on64.replace('HKLM', 'HKCU')
        ];

        let deleteCommands = [];
        let foundAny = false;

        for (const regPath of registryPaths) {
          try {
            // Get all values in the registry key
            const result = execSync(`reg query "${regPath}" 2>nul`, { encoding: 'utf8' });
            const lines = result.split('\n');

            for (const line of lines) {
              if (line.includes(extensionId)) {
                foundAny = true;
                // Extract the value name (usually a number)
                const match = line.match(/^\s*(\d+)\s+REG_SZ/);
                if (match) {
                  const valueName = match[1];
                  const deleteCmd = `reg delete "${regPath}" /v "${valueName}" /f`;
                  deleteCommands.push(deleteCmd);
                  console.log(`   Found policy in: ${regPath} (value: ${valueName})`);
                }
              }
            }
          } catch (e) {
            // Registry key doesn't exist or can't be read - that's fine
          }
        }

        if (!foundAny) {
          console.log('   No Chrome extension policies found to remove');
          return { success: true, message: 'No Chrome extension policies found to remove.' };
        }

        // Execute delete commands individually to handle missing keys gracefully
        let successCount = 0;
        let needsElevation = false;

        for (const cmd of deleteCommands) {
          try {
            execSync(cmd, { stdio: 'pipe' });
            successCount++;
          } catch (e) {
            // If access denied, we need elevation
            if (e.message.includes('Access is denied') || e.message.includes('ERROR: Access')) {
              needsElevation = true;
              break;
            }
            // Otherwise, key might not exist anymore - that's fine, continue
            console.log(`   ⚠️ Could not remove policy (may already be removed): ${e.message.split('\n')[0]}`);
          }
        }

        if (needsElevation) {
          // Try with elevated privileges - join with ; to continue even if one fails
          const sudo = require('sudo-prompt');
          const options = { name: 'RollCloud Installation Wizard' };
          // Use ; instead of && to continue even if individual commands fail
          const allDeleteCmds = deleteCommands.map(cmd => `${cmd} 2>nul`).join(' & ');

          return new Promise((resolve, reject) => {
            sudo.exec(allDeleteCmds, options, (error, stdout, stderr) => {
              // Don't fail if some keys don't exist - as long as we tried to delete them
              if (error && !stderr.includes('unable to find')) {
                console.log(`   ⚠️ Some policies may not have been removed: ${error.message}`);
              }
              console.log(`   ✅ Chrome extension policy removal attempted (elevated)`);
              resolve({ success: true, message: 'Chrome extension uninstalled successfully.' });
            });
          });
        }

        if (successCount > 0) {
          console.log(`   ✅ Removed ${successCount} Chrome extension policy entries`);
        }
        return { success: true, message: 'Chrome extension uninstalled successfully.' };
      } else {
        // macOS/Linux - remove from policy files
        console.log(`   ${browser} uninstall not implemented for ${platform}`);
        return { success: true, message: 'Extension uninstall completed.' };
      }
    }
    
  } catch (error) {
    console.error('Uninstall error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check for extension updates by comparing versions
 */
async function checkForUpdates(browser, config) {
  try {
    console.log(`\n🔄 Checking for updates for ${browser} extension...`);
    
    const platform = process.platform;
    let currentVersion = null;
    let latestVersion = null;
    
    // Get current installed version
    currentVersion = await getInstalledExtensionVersion(browser);
    
    if (!currentVersion) {
      return {
        success: true,
        updateAvailable: false,
        message: 'Extension is not installed',
        currentVersion: null,
        latestVersion: null
      };
    }
    
    // Get latest version from remote
    if (browser === 'chrome') {
      latestVersion = await getChromeLatestVersion(config);
    } else if (browser === 'firefox') {
      latestVersion = await getFirefoxLatestVersion(config);
    }
    
    if (!latestVersion) {
      return {
        success: false,
        error: 'Could not determine latest version',
        currentVersion,
        latestVersion: null
      };
    }
    
    // Compare versions
    const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;
    
    console.log(`  Current version: ${currentVersion}`);
    console.log(`  Latest version: ${latestVersion}`);
    console.log(`  Update available: ${updateAvailable}`);
    
    return {
      success: true,
      updateAvailable,
      currentVersion,
      latestVersion,
      message: updateAvailable ? 'Update available' : 'Extension is up to date'
    };
    
  } catch (error) {
    console.error('Update check error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update extension to latest version
 */
async function updateExtension(browser, config) {
  try {
    console.log(`\n🔄 Updating ${browser} extension...`);
    
    // First check if update is available
    const updateCheck = await checkForUpdates(browser, config);
    
    if (!updateCheck.success) {
      return updateCheck;
    }
    
    if (!updateCheck.updateAvailable) {
      return {
        success: true,
        message: 'Extension is already up to date',
        requiresRestart: false
      };
    }
    
    // For Chrome, update policy will trigger automatic update
    if (browser === 'chrome') {
      console.log('  Updating Chrome extension via policy...');
      const result = await installExtension(browser, config);
      return {
        ...result,
        message: 'Chrome extension update initiated. Restart browser to complete.',
        wasUpdate: true
      };
    }
    
    // For Firefox, we need to reinstall the XPI
    if (browser === 'firefox') {
      console.log('  Updating Firefox extension...');
      
      // Remove existing extension first
      await uninstallExtension(browser);
      
      // Install new version
      const result = await installFirefoxExtension(config);
      
      return {
        ...result,
        message: 'Firefox extension update initiated. Follow the installation prompts.',
        wasUpdate: true
      };
    }
    
    throw new Error(`Unsupported browser for updates: ${browser}`);
    
  } catch (error) {
    console.error('Update error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get current installed extension version
 */
async function getInstalledExtensionVersion(browser) {
  const extensionId = browser === 'firefox' 
    ? EXTENSION_IDS.firefox 
    : EXTENSION_IDS.chrome;
    
  if (!extensionId) return null;
  
  const profileDirs = getBrowserProfileDirs(browser);
  
  for (const profileDir of profileDirs) {
    try {
      if (browser === 'firefox') {
        // Check Firefox extensions.json for version
        const profiles = fs.readdirSync(profileDir).filter(f => {
          const fullPath = path.join(profileDir, f);
          return fs.statSync(fullPath).isDirectory() && f.includes('.default');
        });

        for (const profile of profiles) {
          const extJsonPath = path.join(profileDir, profile, 'extensions.json');
          if (fs.existsSync(extJsonPath)) {
            try {
              const extJson = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
              const addon = extJson.addons?.find(a => a.id === extensionId);
              if (addon && addon.version) {
                console.log(`  Found Firefox version ${addon.version}`);
                return addon.version;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
          
          // Also check manifest.json in extension folder
          const extDir = path.join(profileDir, profile, 'extensions', extensionId);
          if (fs.existsSync(extDir)) {
            const manifestPath = path.join(extDir, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (manifest.version) {
                  console.log(`  Found Firefox version ${manifest.version}`);
                  return manifest.version;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      } else {
        // Chrome - check Preferences or manifest.json
        const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
        for (const profile of profiles) {
          const extDir = path.join(profileDir, profile, 'Extensions', extensionId);
          if (fs.existsSync(extDir)) {
            try {
              const versions = fs.readdirSync(extDir);
              if (versions.length > 0) {
                // Get the latest version folder
                const latestVersion = versions.sort().pop();
                const manifestPath = path.join(extDir, latestVersion, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  if (manifest.version) {
                    console.log(`  Found Chrome version ${manifest.version}`);
                    return manifest.version;
                  }
                }
              }
            } catch (e) {
              // Ignore read errors
            }
          }
          
          // Also check Preferences file
          const prefsPath = path.join(profileDir, profile, 'Preferences');
          if (fs.existsSync(prefsPath)) {
            try {
              const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
              const extSettings = prefs.extensions?.settings?.[extensionId];
              if (extSettings && extSettings.manifest && extSettings.manifest.version) {
                console.log(`  Found Chrome version ${extSettings.manifest.version}`);
                return extSettings.manifest.version;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (e) {
      console.log(`  Error checking profile ${profileDir}:`, e.message);
    }
  }
  
  return null;
}

/**
 * Get latest Chrome version from update manifest
 */
async function getChromeLatestVersion(config) {
  try {
    const https = require('https');
    const updateUrl = config.chromeUpdateUrl || config.updateManifestUrl;
    
    return new Promise((resolve, reject) => {
      https.get(updateUrl, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            // Parse XML to extract version
            const versionMatch = data.match(/version='([^']+)'/);
            if (versionMatch) {
              resolve(versionMatch[1]);
            } else {
              reject(new Error('Version not found in update manifest'));
            }
          } catch (e) {
            reject(new Error('Failed to parse update manifest'));
          }
        });
      }).on('error', (e) => {
        reject(e);
      });
    });
  } catch (error) {
    console.error('Error getting Chrome version:', error);
    return null;
  }
}

/**
 * Get latest Firefox version from GitHub releases
 */
async function getFirefoxLatestVersion(config) {
  try {
    const https = require('https');
    const releasesUrl = 'https://api.github.com/repos/CarmaNayeli/rollCloud/releases/latest';
    
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'RollCloud-Installer'
        }
      };
      
      https.get(releasesUrl, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const versionMatch = release.tag_name?.match(/v?(\d+\.\d+\.\d+)/);
            if (versionMatch) {
              resolve(versionMatch[1]);
            } else {
              reject(new Error('Version not found in release'));
            }
          } catch (e) {
            reject(new Error('Failed to parse release data'));
          }
        });
      }).on('error', (e) => {
        reject(e);
      });
    });
  } catch (error) {
    console.error('Error getting Firefox version:', error);
    return null;
  }
}

/**
 * Compare two version strings (returns -1, 0, or 1)
 */
function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;
  
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

async function forceReinstallExtension(browser, config) {
  try {
    console.log(`\n🔄 Force reinstalling ${browser} extension...`);
    
    // For Chrome, just reinstall the policy (no need to uninstall first)
    if (browser === 'chrome') {
      console.log('  Force reinstalling Chrome extension via policy...');
      
      // Chrome doesn't need uninstall - just set the policy again
      const platform = process.platform;
      const extensionId = config.extensionId;
      const updateUrl = config.chromeUpdateUrl;
      
      if (platform === 'win32') {
        console.log('  Setting Chrome policy via registry...');
        const { execSync } = require('child_process');
        const regPath = 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist';
        
        try {
          // Remove existing policy first
          execSync(`reg query "${regPath}"`, { encoding: 'utf8' });
          console.log('  Found existing Chrome policy, removing...');
          execSync(`reg delete "${regPath}" /f`, { stdio: 'pipe' });
        } catch (e) {
          console.log('  No existing Chrome policy found');
        }
        
        // Add new policy + install sources to allow GitHub downloads
        const policyValue = `${extensionId};${updateUrl}`;
        const sourcesRegPath = 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallSources';
        const cmd = [
          `reg add "${regPath}" /v 1 /t REG_SZ /d "${policyValue}" /f`,
          `reg add "${sourcesRegPath}" /v "1" /t REG_SZ /d "https://github.com/CarmaNayeli/rollCloud/*" /f`,
          `reg add "${sourcesRegPath}" /v "2" /t REG_SZ /d "https://raw.githubusercontent.com/CarmaNayeli/rollCloud/*" /f`
        ].join(' && ');

        execSync(cmd, { stdio: 'pipe' });
        console.log('  ✅ Chrome policy set successfully');
        
        return {
          success: true,
          message: 'Chrome extension force reinstalled. Restart Chrome to complete.',
          wasForceReinstall: true
        };
        
      } else {
        console.log('  Chrome force reinstall not implemented for this platform');
        return {
          success: false,
          error: 'Chrome force reinstall only supported on Windows'
        };
      }
    }
    
    // For Firefox, we need to uninstall first, then reinstall
    if (browser === 'firefox') {
      console.log('  Force reinstalling Firefox extension...');
      
      // Remove existing extension first
      console.log('  Removing existing Firefox extension...');
      await uninstallExtension(browser);
      
      // Wait a moment for removal to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Install new version
      console.log('  Installing new Firefox extension...');
      const result = await installFirefoxExtension(config);
      
      return {
        ...result,
        message: 'Firefox extension force reinstalled. Follow the installation prompts.',
        wasForceReinstall: true
      };
    }
    
    throw new Error(`Unsupported browser for force reinstall: ${browser}`);
    
  } catch (error) {
    console.error('Force reinstall error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Restart browser to apply extension policy
 * Closes the browser and relaunches it
 */
async function restartBrowser(browser) {
  const platform = process.platform;

  console.log(`Restarting ${browser}...`);

  return new Promise((resolve, reject) => {
    let killCmd, launchCmd;

    if (browser === 'chrome') {
      if (platform === 'win32') {
        killCmd = 'taskkill /f /im chrome.exe';
        // Chrome isn't in PATH on Windows - use full path to executable
        const chromePaths = [
          process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
          process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
          (process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)') + '\\Google\\Chrome\\Application\\chrome.exe'
        ];
        // Find existing Chrome path
        const fs = require('fs');
        let chromePath = chromePaths.find(p => fs.existsSync(p));
        if (chromePath) {
          launchCmd = `start "" "${chromePath}"`;
        } else {
          // Fallback to shell protocol handler
          launchCmd = 'start "" "https://google.com"';
          console.log('  Chrome path not found, using URL fallback');
        }
      } else if (platform === 'darwin') {
        killCmd = 'pkill -f "Google Chrome"';
        launchCmd = 'open -a "Google Chrome"';
      } else {
        killCmd = 'pkill -f chrome';
        launchCmd = 'google-chrome &';
      }
    } else if (browser === 'firefox') {
      if (platform === 'win32') {
        killCmd = 'taskkill /f /im firefox.exe';
        // Firefox isn't in PATH on Windows - use full path to executable
        const firefoxPaths = [
          process.env.PROGRAMFILES + '\\Mozilla Firefox\\firefox.exe',
          (process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)') + '\\Mozilla Firefox\\firefox.exe',
          process.env.LOCALAPPDATA + '\\Mozilla Firefox\\firefox.exe'
        ];
        const fs = require('fs');
        let firefoxPath = firefoxPaths.find(p => fs.existsSync(p));
        if (firefoxPath) {
          launchCmd = `start "" "${firefoxPath}"`;
        } else {
          // Fallback
          launchCmd = 'start "" "https://mozilla.org"';
          console.log('  Firefox path not found, using URL fallback');
        }
      } else if (platform === 'darwin') {
        killCmd = 'pkill -f Firefox';
        launchCmd = 'open -a Firefox';
      } else {
        killCmd = 'pkill -f firefox';
        launchCmd = 'firefox &';
      }
    } else {
      return reject(new Error(`Unknown browser: ${browser}`));
    }

    // Kill browser (ignore errors if not running)
    exec(killCmd, (killError) => {
      if (killError) {
        console.log(`  Browser may not have been running: ${killError.message}`);
      }

      // Wait for browser to fully close
      setTimeout(() => {
        // Launch browser
        exec(launchCmd, (launchError) => {
          if (launchError) {
            console.error(`  Failed to launch browser: ${launchError.message}`);
            return reject(launchError);
          }

          console.log(`  ${browser} restarted successfully`);
          resolve({ success: true, message: `${browser} restarted` });
        });
      }, 2000); // Wait 2 seconds for browser to close
    });
  });
}

module.exports = {
  installExtension,
  uninstallExtension,
  isExtensionInstalled,
  installFirefoxDeveloperEdition,
  checkForUpdates,
  updateExtension,
  forceReinstallExtension,
  restartBrowser
};
