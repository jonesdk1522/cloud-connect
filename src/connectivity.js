import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectivityBinary = path.join(__dirname, '../bin/connectivity');

const testConnectivity = (ip, options) => {
  return new Promise((resolve, reject) => {
    const args = [ip, options.mode];
    if (options.mode === 'tcp' && options.port) {
      args.push(options.port);
    }
    
    // Add timeout if provided
    if (options.timeout) {
      args.push(options.timeout.toString());
    }
    
    execFile(connectivityBinary, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          reject(parseError);
        }
      }
    });
  });
};

export { testConnectivity };