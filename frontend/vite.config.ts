import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "kalender-opa.svcode.dev,localhost,127.0.0.1")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    server: {
      host: true,
      allowedHosts
    },
    preview: {
      host: true,
      allowedHosts
    }
  };
});
