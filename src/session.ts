import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { Prisma } from '@prisma/client';
import { useLogger, usePrisma } from './shared';

const fixId = (id: string) => id.replace(/\//g, '__').replace(/:/g, '-');

export async function useSession(sessionId: string) {
  const model = usePrisma().session;
  const logger = useLogger();

  const write = async (data: any, id: string) => {
    try {
      data = JSON.stringify(data, BufferJSON.replacer);
      id = fixId(id);
      await model.upsert({
        select: { pkId: true },
        create: { data, id, sessionId },
        update: { data },
        where: { sessionId_id: { id, sessionId } },
      });
    } catch (e) {
      logger.error(e, 'An error occured during session write');
    }
  };

  const read = async (id: string) => {
    try {
      const { data } = await model.findUniqueOrThrow({
        select: { data: true },
        where: { sessionId_id: { id: fixId(id), sessionId } },
      });
      return JSON.parse(data, BufferJSON.reviver);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        logger.info({ id }, 'Trying to read non existent session data');
      } else {
        logger.error(e, 'An error occured during session read');
      }
      return null;
    }
  };

  const del = async (id: string) => {
    try {
      await model.delete({
        select: { pkId: true },
        where: { sessionId_id: { id: fixId(id), sessionId } },
      });
    } catch (e) {
      logger.error(e, 'An error occured during session delete');
    }
  };

  const creds: AuthenticationCreds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
          const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const sId = `${category}-${id}`;
              tasks.push(value ? write(value, sId) : del(sId));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds'),
  };
}
