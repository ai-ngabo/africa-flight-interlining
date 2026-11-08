/** Static export: the PWA is plain files served by the gateway/edge (no Node server needed, free to host). */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};
export default nextConfig;
