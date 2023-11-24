import * as dotenv from 'dotenv';
dotenv.config();

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PASSWORD: string | undefined;
      NODE_ENV: 'development' | 'production' | 'test';
    }
  }
}

process.env.NODE_ENV ??= 'production';
