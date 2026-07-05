export const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`\x1b[33m[WARN] ${message}\x1b[0m`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`\x1b[31m[ERROR] ${message}\x1b[0m`, ...args);
  }
};
