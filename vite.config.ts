import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:8790';
  const longProxyTimeout = 20 * 60 * 1000;

  return {
    server: {
      port: 3010,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          timeout: longProxyTimeout,
          proxyTimeout: longProxyTimeout,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/client'),
      },
    },
  };
});
