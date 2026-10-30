import resource from '@logto/phrases-experience';
import {
  InteractionEvent,
  SignInIdentifier,
  type VerificationCodeIdentifier,
} from '@logto/schemas';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { HTTPError } from 'ky';

import CaptchaContext from '@/Providers/CaptchaContextProvider/CaptchaContext';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { sendVerificationCode, verifyInteractionCaptcha } from '@/apis/experience';
import { setupI18nForTesting } from '@/jest.setup';
import { UserFlow } from '@/types';

import VerificationCode from '.';

jest.useFakeTimers();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
  useLocation: jest.fn(() => ({ state: { interactionEvent: InteractionEvent.SignIn } })),
}));

jest.mock('@/apis/experience', () => ({
  sendVerificationCode: jest.fn(),
  verifyInteractionCaptcha: jest.fn(),
  identifyWithVerificationCode: jest.fn(),
}));

const requestError = (code: string) =>
  new HTTPError(
    {
      status: 422,
      statusText: 'Unprocessable',
      json: async () => ({ code, message: code }),
    } as unknown as Response,
    {} as Request,
    {} as never
  );

const identifier: VerificationCodeIdentifier = {
  type: SignInIdentifier.Email,
  value: 'foo@logto.io',
};

/** Mydas stop-gap: a spent per-captcha send budget makes resend solve a new captcha in place. */
describe('<VerificationCode /> resend with a spent send budget', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Render the resend link as a clickable <a> (see the main VerificationCode test).
    await setupI18nForTesting({
      translation: {
        description: { resend_passcode: resource.en.translation.description.resend_passcode },
      },
    });
  });

  afterAll(async () => {
    await setupI18nForTesting();
  });

  const renderWithCaptcha = (executeCaptcha: () => Promise<string | undefined | false>) => {
    const view = renderWithPageContext(
      <CaptchaContext.Provider
        value={{
          isCaptchaRequired: true,
          captchaConfig: undefined,
          widgetRef: undefined,
          executeCaptcha,
        }}
      >
        <VerificationCode flow={UserFlow.SignIn} identifier={identifier} verificationId="123456" />
      </CaptchaContext.Provider>
    );
    act(() => {
      jest.advanceTimersByTime(1e3 * 60);
    });

    return view;
  };

  it('solves a new captcha inside the interaction and retries the resend once', async () => {
    jest
      .mocked(sendVerificationCode)
      .mockRejectedValueOnce(requestError('session.captcha_required'))
      .mockResolvedValueOnce({ verificationId: 'renewed' });
    jest.mocked(verifyInteractionCaptcha).mockResolvedValueOnce({} as unknown as Response);
    const executeCaptcha = jest.fn(async () => 'captcha-token');
    const { getByText } = renderWithCaptcha(executeCaptcha);

    await waitFor(() => {
      fireEvent.click(getByText('Resend verification code'));
    });

    await waitFor(() => {
      expect(sendVerificationCode).toHaveBeenCalledTimes(2);
    });
    expect(executeCaptcha).toHaveBeenCalledTimes(1);
    expect(verifyInteractionCaptcha).toHaveBeenCalledWith('captcha-token');
  });

  it('does not resend when the user cancels the captcha', async () => {
    jest
      .mocked(sendVerificationCode)
      .mockRejectedValueOnce(requestError('session.captcha_required'));
    const executeCaptcha = jest.fn(async () => false as const);
    const { getByText } = renderWithCaptcha(executeCaptcha);

    await waitFor(() => {
      fireEvent.click(getByText('Resend verification code'));
    });

    await waitFor(() => {
      expect(executeCaptcha).toHaveBeenCalledTimes(1);
    });
    expect(verifyInteractionCaptcha).not.toHaveBeenCalled();
    expect(sendVerificationCode).toHaveBeenCalledTimes(1);
  });
});
