import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputPath = path.join(root, "public", "live-games.json");
const source = "https://worldcup26.ir/get/games";

async function main() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    const response = await fetch(source, {
      headers: { "User-Agent": "worldcup-ai-predictor/0.1" },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    const wrapped = {
      generatedAt: new Date().toISOString(),
      source,
      sourceNote: "静态比分快照。页面会优先拉实时 API，失败时使用这个文件兜底。",
      games: payload.games ?? [],
    };
    await writeFile(outputPath, JSON.stringify(wrapped, null, 2), "utf8");
    console.log(`实时比分快照完成：${wrapped.games.length} 场。`);
  } catch (error) {
    try {
      await readFile(outputPath, "utf8");
      console.warn(`实时比分拉取失败，保留旧快照：${error.message}`);
    } catch {
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
