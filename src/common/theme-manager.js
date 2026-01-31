/**
 * Theme Manager Utility
 * Handles light/dark/system theme switching with persistence
 */

const ThemeManager = {
  THEMES: {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system'
  },

  currentTheme: 'system',
  systemPrefersDark: false,

  /**
   * Initialize theme manager
   */
  async init() {
    // Check system preference FIRST before loading saved preference
    debug.log('🎨 ThemeManager.init() starting...');
    try {
      if (typeof window === 'undefined' || !window.matchMedia) {
        debug.warn('⚠️ window.matchMedia not available, defaulting to light theme');
        this.systemPrefersDark = false;
      } else {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemPrefersDark = darkModeQuery.matches;

        debug.log('🎨 System dark mode query result:', {
          matches: darkModeQuery.matches,
          media: darkModeQuery.media,
          systemPrefersDark: this.systemPrefersDark
        });
        console.log('🎨 THEME DEBUG: Dark mode query matches:', darkModeQuery.matches);
        console.log('🎨 THEME DEBUG: systemPrefersDark set to:', this.systemPrefersDark);

        // Verify the media query is valid
        if (darkModeQuery.media === 'not all') {
          debug.warn('⚠️ Dark mode media query not supported, defaulting to light theme');
          this.systemPrefersDark = false;
        }

        // Listen for system theme changes
        try {
          darkModeQuery.addEventListener('change', (e) => {
            this.systemPrefersDark = e.matches;
            debug.log('🎨 System dark mode preference changed:', this.systemPrefersDark);
            if (this.currentTheme === this.THEMES.SYSTEM) {
              this.applyTheme(this.THEMES.SYSTEM);
            }
          });
        } catch (listenerError) {
          debug.warn('⚠️ Could not add dark mode change listener:', listenerError);
        }
      }
    } catch (error) {
      debug.error('❌ Error detecting system theme preference:', error);
      this.systemPrefersDark = false;
    }

    // Load saved theme preference
    await this.loadThemePreference();

    // Apply initial theme
    this.applyTheme(this.currentTheme);

    debug.log('🎨 Theme Manager initialized:', {
      currentTheme: this.currentTheme,
      effectiveTheme: this.getEffectiveTheme(this.currentTheme),
      systemPrefersDark: this.systemPrefersDark
    });
  },

  /**
   * Load theme preference from storage
   */
  async loadThemePreference() {
    try {
      if (typeof browserAPI !== 'undefined' && browserAPI.storage) {
        const result = await browserAPI.storage.local.get(['theme']);
        if (result.theme) {
          this.currentTheme = result.theme;
        }
      } else if (typeof localStorage !== 'undefined') {
        // Fallback to localStorage for popup windows
        const saved = localStorage.getItem('rollcloud-theme');
        if (saved) {
          this.currentTheme = saved;
        }
      }
    } catch (error) {
      debug.error('Failed to load theme preference:', error);
    }
  },

  /**
   * Save theme preference to storage
   */
  async saveThemePreference(theme) {
    try {
      this.currentTheme = theme;

      if (typeof browserAPI !== 'undefined' && browserAPI.storage) {
        await browserAPI.storage.local.set({ theme: theme });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rollcloud-theme', theme);
      }

      debug.log('💾 Theme preference saved:', theme);
    } catch (error) {
      debug.error('Failed to save theme preference:', error);
    }
  },

  /**
   * Apply theme to document
   */
  applyTheme(theme) {
    const effectiveTheme = this.getEffectiveTheme(theme);

    debug.log('🎨 Applying theme:', {
      requested: theme,
      effective: effectiveTheme,
      systemPrefersDark: this.systemPrefersDark
    });
    console.log('🎨 THEME DEBUG: Applying theme - requested:', theme, 'effective:', effectiveTheme, 'systemPrefersDark:', this.systemPrefersDark);

    // Remove existing theme classes
    document.documentElement.classList.remove('theme-light', 'theme-dark');

    // Add new theme class
    document.documentElement.classList.add(`theme-${effectiveTheme}`);

    // Set data attribute for CSS targeting
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    console.log('🎨 THEME DEBUG: Applied class:', `theme-${effectiveTheme}`, 'to document element');
    console.log('🎨 THEME DEBUG: Document classes:', document.documentElement.className);

    debug.log('🎨 Theme applied successfully:', effectiveTheme);
  },

  /**
   * Get the effective theme (resolves 'system' to light/dark)
   */
  getEffectiveTheme(theme) {
    if (theme === this.THEMES.SYSTEM) {
      return this.systemPrefersDark ? this.THEMES.DARK : this.THEMES.LIGHT;
    }
    return theme;
  },

  /**
   * Set theme and save preference
   */
  async setTheme(theme) {
    if (!Object.values(this.THEMES).includes(theme)) {
      debug.error('Invalid theme:', theme);
      return;
    }

    await this.saveThemePreference(theme);
    this.applyTheme(theme);

    // Notify other parts of the extension about theme change
    this.notifyThemeChange(theme);
  },

  /**
   * Notify about theme change (for communication between popup/content scripts)
   */
  notifyThemeChange(theme) {
    // Send message to background script
    if (typeof browserAPI !== 'undefined' && browserAPI.runtime) {
      browserAPI.runtime.sendMessage({
        action: 'themeChanged',
        theme: theme
      }).catch(() => {
        // Ignore errors if background script isn't listening
      });
    }

    // Dispatch custom event for same-page listeners
    window.dispatchEvent(new CustomEvent('rollcloud-theme-changed', {
      detail: { theme: theme }
    }));
  },

  /**
   * Get current theme
   */
  getCurrentTheme() {
    return this.currentTheme;
  },

  /**
   * Get effective theme (with system resolved)
   */
  getEffectiveCurrentTheme() {
    return this.getEffectiveTheme(this.currentTheme);
  },

  /**
   * Force refresh system preference detection
   * Call this if system theme detection seems incorrect
   */
  refreshSystemPreference() {
    try {
      if (window.matchMedia) {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const oldValue = this.systemPrefersDark;
        this.systemPrefersDark = darkModeQuery.matches;

        debug.log('🔄 Refreshed system preference:', {
          oldValue: oldValue,
          newValue: this.systemPrefersDark,
          mediaQuery: darkModeQuery.media,
          matches: darkModeQuery.matches
        });

        // Re-apply theme if using system preference
        if (this.currentTheme === this.THEMES.SYSTEM) {
          this.applyTheme(this.THEMES.SYSTEM);
        }

        return this.systemPrefersDark;
      }
    } catch (error) {
      debug.error('❌ Error refreshing system preference:', error);
    }
    return this.systemPrefersDark;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
}
