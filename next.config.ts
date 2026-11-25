import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "fluent-ffmpeg",
    "sharp",
  ],
  outputFileTracingIncludes: {
    "/api/search": ["./model/**/*"],
    "/api/search-by-image": ["./model/**/*"],
  },
};

export default nextConfig;
