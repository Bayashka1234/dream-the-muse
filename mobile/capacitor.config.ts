import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'art.dreammuse.portal',
  appName: 'Dream the Muse',
  webDir: 'www',
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
    cleartext: false
  }
};

export default config;
