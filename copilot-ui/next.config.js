/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Add WebSocket support for client-side
    config.externals.push({
      'utf-8-validate': 'commonjs utf-8-validate',
      'bufferutil': 'commonjs bufferutil',
    });
    return config;
  },
};

module.exports = nextConfig;
