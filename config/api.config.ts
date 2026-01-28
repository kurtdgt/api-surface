import type { ConfigFileInput } from "@api-surface/core";

const config: ConfigFileInput = {
  include: ["src/**/*.{js,jsx,ts,tsx}"],
  exclude: ["**/node_modules/**", "**/dist/**"],
  framework: "generic", // or 'nextjs', 'react', 'none'
  apiClients: [
    { type: "axios" }, // Add this to enable axios detection
    // { type: 'fetch' }, // Optional: also detect fetch calls
  ],
};

export default config;
