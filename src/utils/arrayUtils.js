/**
 * Utility functions for safely handling arrays
 */

// Safely convert any value to an array
export const ensureArray = (input) => {
  if (input === null || input === undefined) return [];
  return Array.isArray(input) ? input : [input];
};

/**
 * Safe version of array map that won't crash on null/undefined
 * @param {Array} array - The array to map
 * @param {Function} callback - The mapping function
 * @returns {Array} - The mapped array or empty array if input was invalid
 */
export const safeMap = (array, callback, defaultValue = []) => {
  if (!array || !Array.isArray(array)) return defaultValue;
  
  try {
    return array.map(callback);
  } catch (e) {
    console.error('Error in map operation:', e.message);
    return defaultValue;
  }
};

/**
 * Install protection for global array methods (used in React app, not CLI)
 */
export function installGlobalArrayProtection() {
  // This is meant only for the React frontend part
  if (typeof window === 'undefined') return;
  
  if (!Array.prototype.originalMap) {
    Array.prototype.originalMap = Array.prototype.map;
    Array.prototype.map = function(callback) {
      if (!this) return [];
      try {
        return Array.prototype.originalMap.call(this, callback);
      } catch (e) {
        console.error('Protected from map error:', e);
        return [];
      }
    };
  }
}
