import { defaultConnectorMethods } from '@logto/cli/lib/connector/index.js';
import { ConnectorType, TemplateType } from '@logto/connector-kit';
import { type Passcode } from '@logto/schemas';
import { any } from 'zod';

import { mockConnector, mockMetadata } from '#src/__mocks__/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { MockQueries } from '#src/test-utils/tenant.js';

import { createPasscodeLibrary } from './passcode.js';

const { jest } = import.meta;

const getMessageConnector = jest.fn();

const unusedPasscodeQueries = {
  consumePasscode: jest.fn(),
  deletePasscodesByIds: jest.fn(),
  findUnconsumedPasscodeByIdentifierAndType: jest.fn(),
  findUnconsumedPasscodeByJtiAndType: jest.fn(),
  findUnconsumedPasscodesByIdentifierAndType: jest.fn(),
  findUnconsumedPasscodesByJtiAndType: jest.fn(),
  increasePasscodeTryCount: jest.fn(),
  insertPasscode: jest.fn(),
};

const { sendPasscode } = createPasscodeLibrary(
  new MockQueries({ passcodes: unusedPasscodeQueries }),
  // @ts-expect-error Only connector lookups are required in these tests.
  { getMessageConnector }
);

describe('sendPasscode', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each(['14155552671', '85261234567', '886912345678', '86138001380001', '+8613800138000'])(
    'blocks unsupported SMS destinations before connector lookup: %s',
    async (phone) => {
      await expect(
        sendPasscode({
          tenantId: 'fake_tenant',
          id: 'blocked',
          interactionJti: 'jti',
          phone,
          email: null,
          type: TemplateType.SignIn,
          code: '123456',
          consumed: false,
          tryCount: 0,
          createdAt: Date.now(),
        })
      ).rejects.toMatchObject({ code: 'verification_code.mainland_only', status: 422 });
      expect(getMessageConnector).not.toHaveBeenCalled();
    }
  );

  it('should let the connector handle template selection on the send path', async () => {
    const sendMessage = jest.fn();
    getMessageConnector.mockResolvedValueOnce({
      ...defaultConnectorMethods,
      configGuard: any(),
      dbEntry: {
        ...mockConnector,
        id: 'id0',
        config: {},
      },
      metadata: {
        ...mockMetadata,
        platform: null,
      },
      type: ConnectorType.Email,
      sendMessage,
    });
    const passcode: Passcode = {
      tenantId: 'fake_tenant',
      id: 'passcode_id',
      interactionJti: 'jti',
      phone: null,
      email: 'foo@example.com',
      type: TemplateType.ForgotPassword,
      code: '1234',
      consumed: false,
      tryCount: 0,
      createdAt: Date.now(),
    };

    await sendPasscode(passcode, { locale: 'en' });

    expect(sendMessage).toHaveBeenCalledWith({
      to: 'foo@example.com',
      type: TemplateType.ForgotPassword,
      payload: {
        code: '1234',
        locale: 'en',
      },
    });
  });
});

describe('sendPasscode', () => {
  it('should throw error when email and phone are both empty', async () => {
    const passcode: Passcode = {
      tenantId: 'fake_tenant',
      id: 'id',
      interactionJti: 'jti',
      phone: null,
      email: null,
      type: TemplateType.SignIn,
      code: '1234',
      consumed: false,
      tryCount: 0,
      createdAt: Date.now(),
    };
    await expect(sendPasscode(passcode)).rejects.toThrowError(
      new RequestError('verification_code.phone_email_empty')
    );
  });

  it('should call sendPasscode with params matching', async () => {
    const sendMessage = jest.fn();
    getMessageConnector.mockResolvedValueOnce({
      ...defaultConnectorMethods,
      configGuard: any(),
      dbEntry: {
        ...mockConnector,
        id: 'id0',
        config: {
          templates: [{ usageType: TemplateType.SignIn, content: 'code {{code}}' }],
        },
      },
      metadata: {
        ...mockMetadata,
        platform: null,
      },
      type: ConnectorType.Sms,
      sendMessage,
    });
    const passcode: Passcode = {
      tenantId: 'fake_tenant',
      id: 'passcode_id',
      interactionJti: 'jti',
      phone: '8613800138000',
      email: null,
      type: TemplateType.SignIn,
      code: '1234',
      consumed: false,
      tryCount: 0,
      createdAt: Date.now(),
    };
    await sendPasscode(passcode, { locale: 'en' });
    expect(sendMessage).toHaveBeenCalledWith({
      to: passcode.phone,
      type: passcode.type,
      payload: {
        code: passcode.code,
        locale: 'en',
      },
    });
  });

  it('should include IP address when provided in context payload', async () => {
    const sendMessage = jest.fn();
    getMessageConnector.mockResolvedValueOnce({
      ...defaultConnectorMethods,
      configGuard: any(),
      dbEntry: {
        ...mockConnector,
        id: 'id0',
        config: {
          templates: [{ usageType: TemplateType.SignIn, content: 'code {{code}}' }],
        },
      },
      metadata: {
        ...mockMetadata,
        platform: null,
      },
      type: ConnectorType.Sms,
      sendMessage,
    });
    const passcode: Passcode = {
      tenantId: 'fake_tenant',
      id: 'passcode_id',
      interactionJti: 'jti',
      phone: '8613800138000',
      email: null,
      type: TemplateType.SignIn,
      code: '1234',
      consumed: false,
      tryCount: 0,
      createdAt: Date.now(),
    };
    await sendPasscode(passcode, { locale: 'en', ip: '192.168.1.100' });
    expect(sendMessage).toHaveBeenCalledWith({
      to: passcode.phone,
      type: passcode.type,
      payload: {
        code: passcode.code,
        locale: 'en',
      },
      ip: '192.168.1.100',
    });
  });
});
