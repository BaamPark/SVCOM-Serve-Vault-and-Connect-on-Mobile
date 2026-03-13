const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:3210";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`
      },
      {
        source: "/health",
        destination: `${backendOrigin}/health`
      }
    ];
  }
};

module.exports = nextConfig;
