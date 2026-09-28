import { type GoCaptchaChallenge, goCaptchaChallengeGuard } from '@logto/schemas';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import api from '@/apis/api';
import Button from '@/shared/components/Button';

import styles from './go-captcha.module.scss';

type Props = {
  readonly onComplete: (token: string) => void;
  readonly onCancel: () => void;
};

const GoCaptcha = ({ onComplete, onCancel }: Props) => {
  const { t } = useTranslation();
  const [challenge, setChallenge] = useState<GoCaptchaChallenge>();
  const [position, setPosition] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setChallenge(undefined);
    setPosition(0);
    setFailed(false);
    const load = async () => {
      try {
        const data = await api
          .post('/api/experience/captcha', { signal: controller.signal, retry: 0 })
          .json();
        if (!controller.signal.aborted) {
          setChallenge(goCaptchaChallengeGuard.parse(data));
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [generation]);

  return (
    <section
      className={styles.captcha}
      aria-label={t('action.captcha_slide')}
      aria-busy={!challenge && !failed}
    >
      <p aria-live="polite">
        {failed ? t('error.captcha_verification_failed') : t('action.captcha_slide')}
      </p>
      {challenge && (
        <>
          <div
            className={styles.puzzle}
            style={{ aspectRatio: `${challenge.width} / ${challenge.height}` }}
          >
            <img className={styles.background} src={challenge.image} alt="" draggable={false} />
            <img
              className={styles.tile}
              src={challenge.tile}
              alt=""
              draggable={false}
              style={{
                left: `${(position / challenge.width) * 100}%`,
                top: `${(challenge.y / challenge.height) * 100}%`,
                width: `${(challenge.tileWidth / challenge.width) * 100}%`,
                height: `${(challenge.tileHeight / challenge.height) * 100}%`,
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={challenge.width - challenge.tileWidth}
            step={1}
            value={position}
            aria-label={t('action.captcha_slide')}
            onChange={(event) => {
              setPosition(Number(event.target.value));
            }}
          />
        </>
      )}
      <div className={styles.actions}>
        <Button
          type="secondary"
          size="small"
          title="action.captcha_refresh"
          onClick={() => {
            setGeneration((value) => value + 1);
          }}
        />
        <Button type="secondary" size="small" title="action.cancel" onClick={onCancel} />
        <Button
          size="small"
          title="action.confirm"
          isDisabled={!challenge}
          onClick={() => {
            if (challenge) {
              onComplete(JSON.stringify({ token: challenge.token, x: position, y: challenge.y }));
            }
          }}
        />
      </div>
    </section>
  );
};

export default GoCaptcha;
