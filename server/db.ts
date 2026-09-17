import * as schema from "../shared/schema";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_FILE = path.join(process.cwd(), "bubblesheet_local.json");

interface LocalData {
  users: any[];
  answerKeys: any[];
  scanResults: any[];
}

function loadLocalData(): LocalData {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch {
      // ignore
    }
  }
  return { users: [], answerKeys: [], scanResults: [] };
}

function saveLocalData(data: LocalData) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save local db:", e);
  }
}

function matchWhere(item: any, sqlClause: any): boolean {
  if (!sqlClause) return true;

  const chunks: any[] = sqlClause?.queryChunks || [];
  if (!chunks.length) return true;

  const pairs: Array<{ col: string; val: any }> = [];

  function extractPairs(chunkList: any[]) {
    for (let i = 0; i < chunkList.length; i++) {
      const c = chunkList[i];
      if (c?.queryChunks) {
        extractPairs(c.queryChunks);
      } else if (c?.name && chunkList[i + 2]?.value !== undefined) {
        pairs.push({ col: c.name, val: chunkList[i + 2].value });
      }
    }
  }

  extractPairs(chunks);

  for (const { col, val } of pairs) {
    if (col === "user_id" || col === "userId") {
      if (item.userId !== val && item.user_id !== val) return false;
    } else if (col === "id") {
      if (item.id !== val) return false;
    } else if (col === "username") {
      if (item.username !== val) return false;
    } else if (col === "answer_key_id" || col === "answerKeyId") {
      if (item.answerKeyId !== val && item.answer_key_id !== val) return false;
    }
  }

  return true;
}

export const db: any = {
  query: {
    users: {
      findFirst: async (options: any) => {
        const localData = loadLocalData();
        if (!options || !options.where) return localData.users[0] || null;
        return localData.users.find((u) => matchWhere(u, options.where)) || null;
      },
      findMany: async () => {
        const localData = loadLocalData();
        return localData.users;
      },
    },
    answerKeys: {
      findFirst: async (options: any) => {
        const localData = loadLocalData();
        const rows = localData.answerKeys;
        if (!options || !options.where) return rows[0] || null;
        return rows.find((k) => matchWhere(k, options.where)) || null;
      },
      findMany: async (options: any) => {
        const localData = loadLocalData();
        let rows = localData.answerKeys;
        if (options?.where) {
          rows = rows.filter((k) => matchWhere(k, options.where));
        }
        return rows;
      },
    },
    scanResults: {
      findFirst: async (options: any) => {
        const localData = loadLocalData();
        const rows = localData.scanResults;
        if (!options || !options.where) return rows[0] || null;
        return rows.find((s) => matchWhere(s, options.where)) || null;
      },
      findMany: async (options: any) => {
        const localData = loadLocalData();
        let rows = localData.scanResults;
        if (options?.where) {
          rows = rows.filter((s) => matchWhere(s, options.where));
        }
        return rows;
      },
    },
  },
  insert: (table: any) => {
    const tableName = table === schema.users ? "users" : table === schema.answerKeys ? "answerKeys" : "scanResults";
    return {
      values: (val: any) => {
        const row = {
          id: val.id || crypto.randomUUID(),
          createdAt: new Date(),
          scannedAt: new Date(),
          ...val,
        };
        const localData = loadLocalData();
        if (tableName === "users") localData.users.push(row);
        else if (tableName === "answerKeys") localData.answerKeys.push(row);
        else if (tableName === "scanResults") localData.scanResults.push(row);
        saveLocalData(localData);

        return {
          returning: async () => [row],
          then: (resolve: any) => resolve([row]),
        };
      },
    };
  },
  update: (table: any) => {
    const tableName = table === schema.users ? "users" : table === schema.answerKeys ? "answerKeys" : "scanResults";
    return {
      set: (updates: any) => ({
        where: (whereClause: any) => ({
          then: (resolve: any) => {
            const localData = loadLocalData();
            const list: any[] = (localData as any)[tableName] || [];
            for (let i = 0; i < list.length; i++) {
              if (matchWhere(list[i], whereClause)) {
                list[i] = { ...list[i], ...updates };
              }
            }
            saveLocalData(localData);
            resolve({ ok: true });
          },
        }),
      }),
    };
  },
  delete: (table: any) => {
    const tableName = table === schema.users ? "users" : table === schema.answerKeys ? "answerKeys" : "scanResults";
    return {
      where: (whereClause: any) => ({
        then: (resolve: any) => {
          const localData = loadLocalData();
          (localData as any)[tableName] = ((localData as any)[tableName] || []).filter(
            (item: any) => !matchWhere(item, whereClause)
          );
          saveLocalData(localData);
          resolve({ ok: true });
        },
      }),
    };
  },
};
