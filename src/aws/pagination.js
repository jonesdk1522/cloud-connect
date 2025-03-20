/**
 * Handles pagination for AWS SDK v3 commands using native SDK pagination
 * @param {Object} client - AWS SDK client
 * @param {Function} commandConstructor - Command constructor function
 * @param {Object} params - Command parameters
 * @param {string} itemsKey - Key for items in the response
 * @returns {Array} - Aggregated results from all pages
 */
export const paginateCommand = async (client, commandConstructor, params, itemsKey) => {
  let allItems = [];
  let nextToken;
  
  try {
    do {
      // Create command with next token if available
      const command = new commandConstructor({ 
        ...params, 
        ...(nextToken ? { NextToken: nextToken } : {}) 
      });
      
      const response = await client.send(command);
      
      // Add items to result array if they exist
      if (response[itemsKey]) {
        allItems = allItems.concat(response[itemsKey]);
      }
      
      // Get next token for pagination
      nextToken = response.NextToken;
    } while (nextToken);
    
    return allItems;
  } catch (error) {
    console.error(`Error during AWS pagination:`, error);
    throw error;
  }
};
