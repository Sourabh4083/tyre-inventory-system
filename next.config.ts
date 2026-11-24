import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  agentRules: false,
  poweredByHeader: false,
  // Uploads go through server actions: employee documents (up to 4 MB) and the company
  // price list (.xlsx, about 5 MB).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // The bill PDF reads its fonts from disk at request time; ship them with that route.
  outputFileTracingIncludes: { "/b/[token]/pdf": ["./src/assets/fonts/*.ttf"] },
};

export default nextConfig;
