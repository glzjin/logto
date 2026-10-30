import { InteractionEvent, type VerificationCodeIdentifier } from '@logto/schemas';
import { t } from 'i18next';
import { useCallback, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTimer } from 'react-timer-hook';

import CaptchaContext from '@/Providers/CaptchaContextProvider/CaptchaContext';
import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import { sendVerificationCode, verifyInteractionCaptcha } from '@/apis/experience';
import { getInteractionEventFromState, userFlowToInteractionEventMap } from '@/apis/utils';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useToast from '@/hooks/use-toast';
import { UserFlow } from '@/types';
import { codeVerificationTypeMap } from '@/utils/sign-in-experience';

export const timeRange = 59;

const getTimeout = () => {
  const now = new Date();
  now.setSeconds(now.getSeconds() + timeRange);

  return now;
};

const useResendVerificationCode = (flow: UserFlow, identifier: VerificationCodeIdentifier) => {
  const { setToast } = useToast();
  const { state } = useLocation();

  const interactionEvent = useMemo<InteractionEvent>(() => {
    if (flow === UserFlow.Continue) {
      const interactionEvent = getInteractionEventFromState(state);
      console.log('interactionEvent', interactionEvent);
      return interactionEvent ?? InteractionEvent.SignIn;
    }

    return userFlowToInteractionEventMap[flow];
  }, [flow, state]);

  const { seconds, isRunning, restart } = useTimer({
    autoStart: true,
    expiryTimestamp: getTimeout(),
  });

  const handleError = useErrorHandler();
  const resendVerificationCode = useApi(sendVerificationCode);
  const verifyCaptcha = useApi(verifyInteractionCaptcha);
  const { executeCaptcha } = useContext(CaptchaContext);
  const { setVerificationId } = useContext(UserInteractionContext);

  const onResendVerificationCode = useCallback(async () => {
    const resend = async (allowCaptchaRetry: boolean): Promise<void> => {
      const [error, result] = await resendVerificationCode(interactionEvent, identifier);

      if (error) {
        await handleError(
          error,
          allowCaptchaRetry
            ? {
                // Mydas stop-gap: a spent per-captcha send budget asks for a new captcha. Solve
                // it in place (keeping the interaction) and retry the resend once.
                'session.captcha_required': async () => {
                  const captchaToken = await executeCaptcha();

                  if (!captchaToken) {
                    return;
                  }

                  const [verifyError] = await verifyCaptcha(captchaToken);

                  if (verifyError) {
                    await handleError(verifyError);

                    return;
                  }

                  await resend(false);
                },
              }
            : undefined
        );

        return;
      }

      if (result) {
        // Renew the verification ID in the context
        setVerificationId(codeVerificationTypeMap[identifier.type], result.verificationId);
        setToast(t('description.passcode_sent'));
        restart(getTimeout(), true);
      }
    };

    await resend(true);
  }, [
    resendVerificationCode,
    verifyCaptcha,
    executeCaptcha,
    interactionEvent,
    identifier,
    handleError,
    setVerificationId,
    setToast,
    restart,
  ]);

  return {
    seconds,
    isRunning,
    onResendVerificationCode,
  };
};

export default useResendVerificationCode;
