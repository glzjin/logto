import {
  LogResult,
  userInfoSelectFields,
  type Hook,
  type HookConfig,
  type HookEvent,
  type HookEventPayload,
  type HookTestErrorResponseData,
  type InteractionHookEventPayload,
  type ManagementHookEventPayload,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { conditional, pick, trySafe } from '@silverhand/essentials';
import { HTTPError } from 'ky';

import RequestError from '#src/errors/RequestError/index.js';
import { LogEntry } from '#src/middleware/koa-audit-log.js';
import type Queries from '#src/tenants/Queries.js';
import { consoleLog } from '#src/utils/console.js';

import {
  eventToHook,
  type InteractionHookContext,
  type InteractionHookResult,
  type ManagementHookContextManager,
} from './types.js';
import { generateHookTestPayload, parseResponse, sendWebhookRequest } from './utils.js';

export const createHookLibrary = (queries: Queries) => {
  const {
    applications: { findApplicationById },
    logs: { insertLog },
    // TODO: @gao should we use the library function thus we can pass full userinfo to the payload?
    users: { findUserById },
    hooks: { findAllHooks, findHookById },
  } = queries;

  const sendWebhooks = async <T extends HookEventPayload>(hooks: Hook[], payload: T) =>
    Promise.all(
      hooks.map(async ({ id, config, signingKey }) => {
        consoleLog.info(`\tTriggering hook ${id} due to ${payload.event} event`);

        // Required:  Override the hookId in the payload
        const json: HookEventPayload = { ...payload, hookId: id };
        const logEntry = new LogEntry(`TriggerHook.${payload.event}`);

        logEntry.append({ hookId: id, hookRequest: { body: json } });

        // Trigger web hook and log response
        await sendWebhookRequest({
          hookConfig: config,
          payload: json,
          signingKey,
        })
          .then(async (response) => {
            logEntry.append({
              response: await parseResponse(response),
            });
          })
          .catch(async (error) => {
            logEntry.append({
              result: LogResult.Error,
              response: conditional(
                error instanceof HTTPError && (await parseResponse(error.response))
              ),
              error: conditional(error instanceof Error && String(error)),
            });
          });

        consoleLog.info(
          `\tHook ${id} ${logEntry.payload.result === LogResult.Success ? 'succeeded' : 'failed'}`
        );

        await insertLog({
          id: generateStandardId(),
          key: logEntry.key,
          payload: logEntry.payload,
        });
      })
    );

  const triggerInteractionHooks = async (
    interactionContext: InteractionHookContext,
    interactionResult: InteractionHookResult,
    userAgent?: string
  ) => {
    const { userId } = interactionResult;
    const { event, sessionId, applicationId, userIp } = interactionContext;

    const hookEvent = eventToHook[event];
    const found = await findAllHooks();
    const rows = found.filter(
      ({ event, events, enabled }) =>
        enabled && (events.length > 0 ? events.includes(hookEvent) : event === hookEvent) // For backward compatibility
    );

    if (rows.length === 0) {
      return;
    }

    const [user, application] = await Promise.all([
      trySafe(findUserById(userId)),
      trySafe(async () => conditional(applicationId && (await findApplicationById(applicationId)))),
    ]);

    const payload = {
      event: hookEvent,
      interactionEvent: event,
      createdAt: new Date().toISOString(),
      sessionId,
      userAgent,
      userId,
      userIp,
      user: user && pick(user, ...userInfoSelectFields),
      application: application && pick(application, 'id', 'type', 'name', 'description'),
    } satisfies Omit<InteractionHookEventPayload, 'hookId'>;

    await sendWebhooks(rows, {
      ...payload,
      /**
       * Make the typescript happy.
       * Should not pass the hookId to the payload here.
       * The hookId should be passed in from the hooks DB element.
       * This is because typescript Omit does not work well with the Record<string, unknown> type.
       * We can not use the Omit<HookEventPayload, 'hookId'> type for the sendWebHooks function.
       */
      hookId: '',
    });
  };

  /**
   * Trigger management hooks with the given context. All context objects will be used to trigger
   * hooks.
   */
  const triggerManagementHooks = async (hooks: ManagementHookContextManager) => {
    if (hooks.contextArray.length === 0) {
      return;
    }

    const found = await findAllHooks();

    await Promise.all(
      hooks.contextArray.map(async ({ event, data }) => {
        const rows = found.filter(
          ({ event: hookEvent, events, enabled }) =>
            enabled && (events.length > 0 ? events.includes(event) : event === hookEvent)
        );

        if (rows.length === 0) {
          return;
        }

        const payload = {
          event,
          createdAt: new Date().toISOString(),
          ...hooks.metadata,
          ...data,
        } satisfies Omit<ManagementHookEventPayload, 'hookId'>;

        await sendWebhooks(rows, {
          ...payload,
          // Make the typescript happy.
          hookId: '',
        });
      })
    );
  };

  const testHook = async (hookId: string, events: HookEvent[], config: HookConfig) => {
    const { signingKey } = await findHookById(hookId);
    try {
      await Promise.all(
        events.map(async (event) => {
          const testPayload = generateHookTestPayload(hookId, event);
          await sendWebhookRequest({
            hookConfig: config,
            payload: testPayload,
            signingKey,
          });
        })
      );
    } catch (error: unknown) {
      if (error instanceof HTTPError) {
        throw new RequestError(
          {
            status: 422,
            code: 'hook.endpoint_responded_with_error',
          },
          {
            responseStatus: error.response.status,
            responseBody: await error.response.text(),
          } satisfies HookTestErrorResponseData
        );
      }

      throw new RequestError({
        code: 'hook.send_test_payload_failed',
        message: conditional(error instanceof Error && String(error)) ?? 'Unknown error',
        status: 422,
      });
    }
  };

  return {
    triggerInteractionHooks,
    triggerManagementHooks,
    testHook,
  };
};
