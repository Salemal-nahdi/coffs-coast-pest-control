/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Serve local brand images unoptimized to avoid any distortion/processing.
    // Vercel free tier handles unoptimized images without image optimization quota.
    unoptimized: true
  },
  eslint: {
    // ESLint is intentionally not installed (zero-maintenance). Lint output is
    // informational only; builds ignore it. Type-checking still runs separately.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
