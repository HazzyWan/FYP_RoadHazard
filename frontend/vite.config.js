import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
// Update the IP below if your LAN IP changes
const LAN_IP = '192.168.0.11'
const CERT_PATH = path.resolve(__dirname, `../${LAN_IP}+2.pem`)
const KEY_PATH = path.resolve(__dirname, `../${LAN_IP}+2-key.pem`)
const HAS_CERT = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)
const USE_HTTPS = process.env.VITE_USE_HTTPS === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: USE_HTTPS && HAS_CERT
      ? {
          key: fs.readFileSync(KEY_PATH),
          cert: fs.readFileSync(CERT_PATH),
        }
      : false,
  },
})