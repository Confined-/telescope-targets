import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN devices (phone/tablet testing over http://<lan-ip>:3101).
  allowedDevOrigins: ["192.168.1.144"],
};

export default nextConfig;
