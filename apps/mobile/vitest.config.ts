import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react-native': path.resolve(__dirname, './test/mocks/react-native.ts'),
      'expo-sqlite': path.resolve(__dirname, './test/mocks/expo-sqlite.ts'),
      'expo-notifications': path.resolve(__dirname, './test/mocks/expo-notifications.ts'),
      '@react-native-community/netinfo': path.resolve(__dirname, './test/mocks/netinfo.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
