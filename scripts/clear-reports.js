const { clearAllReports } = require('../src/reportStore');

async function main() {
  const clearedCount = await clearAllReports();
  console.log(`Cleared ${clearedCount} report(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
