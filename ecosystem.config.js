// PM2 ecosystem для продакшен-деплоя
// Запуск: pm2 start ecosystem.config.js
// Логи:   pm2 logs vologda-azs
// Рестарт: pm2 restart vologda-azs
// Сохранить список для автозапуска: pm2 save && pm2 startup systemd
module.exports = {
  apps: [
    {
      name: 'vologda-azs',
      cwd: '/var/www/vologda-azs',
      script: '.next/standalone/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // ВАЖНО: путь к БД должен быть абсолютным на вашем сервере.
        // Если ставите в другую папку — поменяйте здесь.
        DATABASE_URL: 'file:/var/www/vologda-azs/db/custom.db',
      },
      instances: 1, // SQLite не любит параллельные записи — держим 1 инстанс
      autorestart: true,
      max_memory_restart: '500M',
      error_file: '/var/log/vologda-azs/err.log',
      out_file: '/var/log/vologda-azs/out.log',
      time: true,
    },
  ],
}
