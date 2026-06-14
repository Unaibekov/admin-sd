const { createApp } = require('./src/app');

const app = createApp();
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Sadovnik Diary admin running at http://localhost:${port}`);
});
