const { createApp } = require('./src/app');

const app = createApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Sadovnik Diary admin running at http://${host}:${port}`);
  });
}

module.exports = {
  app,
  host,
  port
};
