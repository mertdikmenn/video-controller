// --- CONFIGURATION ---
// Set this to true when you want to "deploy" or stop seeing logs.
const IS_PRODUCTION = true;

export const logger = {
  /**
   * Logs standard messages. Only outputs to the console if IS_PRODUCTION is false.
   * @param {...any} args - The messages or objects to log.
   */
  log: (...args) => {
    if (!IS_PRODUCTION) {
      console.log(...args);
    }
  },

  /**
   * Logs warning messages. Only outputs to the console if IS_PRODUCTION is false.
   * @param {...any} args - The messages or objects to log as a warning.
   */
  warn: (...args) => {
    if (!IS_PRODUCTION) {
      console.warn(...args);
    }
  },

  /**
   * Logs error messages. This will ALWAYS output to the console, regardless of the
   * IS_PRODUCTION flag, as errors are important to see.
   * @param {...any} args - The messages or objects to log as an error.
   */
  error: (...args) => {
    console.error(...args);
  }
};