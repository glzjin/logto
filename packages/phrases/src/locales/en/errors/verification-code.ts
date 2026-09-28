const verification_code = {
  mainland_only:
    'SMS codes are only available for +86 numbers. For other country codes, sign in with Telegram.',
  phone_email_empty: 'Both phone and email are empty.',
  not_found: 'Verification code not found. Please send verification code first.',
  phone_mismatch: 'Phone mismatch. Please request a new verification code.',
  email_mismatch: 'Email mismatch. Please request a new verification code.',
  code_mismatch: 'Invalid verification code.',
  expired: 'Verification code has expired. Please request a new verification code.',
  exceed_max_try:
    'Verification code retries limitation exceeded. Please request a new verification code.',
};

export default Object.freeze(verification_code);
