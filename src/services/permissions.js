/**
 * Check if an error is related to AWS permissions
 * @param {Error} error - The error to check
 * @returns {boolean} - Whether the error is permission related
 */
export function isPermissionError(error) {
  const permissionErrorCodes = [
    'AccessDenied',
    'AuthFailure',
    'UnauthorizedOperation',
    'InvalidClientTokenId'
  ];
  
  return error && 
    ((error.Code && permissionErrorCodes.includes(error.Code)) || 
     (error.$metadata?.httpStatusCode === 403));
}

/**
 * Check if we have permission to perform an operation
 * @param {string} operationName - Name of the operation to check
 * @param {Function} operationFn - Function that performs the operation
 * @returns {Object} - Result of the permission check
 */
export async function checkPermission(operationName, operationFn) {
  try {
    console.log(`→ Testing ${operationName}...`);
    await operationFn();
    console.log(`✓ Permission check passed for ${operationName}`);
    return { passed: true, operation: operationName };
  } catch (error) {
    console.error(`Error during ${operationName}: ${error.message}`);
    console.log(`✗ Permission check failed for ${operationName}`);
    return { 
      passed: false, 
      operation: operationName,
      error 
    };
  }
}
