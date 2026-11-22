import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.coresrdi.pneuvue",
  appName: "PneuVue",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
