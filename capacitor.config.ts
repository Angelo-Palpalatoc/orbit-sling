import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.angelopalpalatoc.orbitsling',
  appName: 'Orbit Sling',
  webDir: 'dist',
  backgroundColor: '#0B101B',
  android: {
    backgroundColor: '#0B101B',
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
