// PM2 config for the demo server (other settings come from .env via dotenv).
module.exports = {
  apps: [
    {
      name: 'demo-api-transaction',
      script: 'server.js',
      cwd: __dirname,
      // Rate limit is in-memory, so keep a single instance.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
