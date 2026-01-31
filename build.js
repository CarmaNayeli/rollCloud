/**
 * RollCloud Browser Extension Build Script
 * Bundles extension with @carmaclouds/core
 */

import { buildExtension } from '../build-tools/esbuild-extension.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

await buildExtension({
  packageDir: __dirname,
  outDir: 'dist',
  entryPoints: {
    // Main extension files
    'src/background': './src/background.js',
    'src/popup/popup': './src/popup/popup.js',
    'src/popup-sheet': './src/popup-sheet.js',
    'src/status-bar': './src/status-bar.js',
    'src/content/dicecloud': './src/content/dicecloud.js',
    'src/content/roll20': './src/content/roll20.js',
    'src/content/character-sheet-overlay': './src/content/character-sheet-overlay.js',
  },
  copyFiles: [
    // Manifests
    'manifest.json',
    'manifest_firefox.json',
    'manifest_safari.json',
    // Static assets
    'icons',
    'src/popup/popup.html',
    'src/popup/popup.css',
    'src/popup-sheet.html',
    'src/status-bar.html',
    'src/options/welcome.html',
  ],
  watch,
  minify
});
