const verification_code = {
  mainland_only:
    'I codici SMS sono disponibili solo per numeri +86. Per altri prefissi, accedi con Telegram.',
  phone_email_empty: "Entrambi il telefono e l'e-mail sono vuoti.",
  not_found: 'Codice di verifica non trovato. Si prega di inviare il codice di verifica per primo.',
  phone_mismatch:
    'Telefono non corrispondente. Si prega di richiedere un nuovo codice di verifica.',
  email_mismatch: 'Email non corrispondente. Si prega di richiedere un nuovo codice di verifica.',
  code_mismatch: 'Codice di verifica non valido.',
  expired: 'Il codice di verifica è scaduto. Si prega di richiedere un nuovo codice di verifica.',
  exceed_max_try:
    'Superata la limitazione dei tentativi di codice di verifica. Si prega di richiedere un nuovo codice di verifica.',
};

export default Object.freeze(verification_code);
