/* Suggested phrases for the "Say it" screen, in English only. You choose which ones to use and
 * type the translation into the destination language yourself. top = among the most useful. */
window.BuilderDefaults = (function () {
  var SUGGESTED = [
    { group: 'Basics', items: [
      { en: 'Hello, good morning.', top: 1 }, { en: 'Thank you.', top: 1 }, { en: 'Please.' }, { en: 'Excuse me.', top: 1 },
      { en: 'Yes.' }, { en: 'No.' }, { en: 'Do you speak English?', top: 1 }, { en: "I don't understand.", top: 1 },
      { en: 'Can you speak more slowly, please?' }, { en: 'Can you write it down, please?', top: 1 }
    ] },
    { group: 'Eating out', items: [
      { en: 'A table for two, please.' }, { en: 'The menu, please.' }, { en: 'The bill, please.', top: 1 },
      { en: 'Still water, please.' }, { en: 'Coffee with milk, please.' }, { en: 'I am allergic to nuts.' },
      { en: 'No salt, please.' }, { en: 'Can I pay by card?' }
    ] },
    { group: 'Getting around', items: [
      { en: 'Where is the toilet?', top: 1 }, { en: 'I am lost.', top: 1 }, { en: 'Please call me a taxi.' },
      { en: 'How much does it cost?', top: 1 }, { en: 'Where is the bus stop?' }, { en: 'Where is the metro station?' },
      { en: 'Does this go to the city centre?' }, { en: 'Please tell me when to get off.' }, { en: 'Is there a lift?' },
      { en: 'Can we sit down somewhere?' }
    ] },
    { group: 'Health and emergency', items: [
      { en: 'Help!', top: 1 }, { en: 'I need a doctor.', top: 1 }, { en: 'Please call an ambulance.', top: 1 },
      { en: 'Where is the nearest pharmacy?', top: 1 }, { en: 'Where is the hospital?' }, { en: 'I have diabetes.' },
      { en: 'I have a heart condition.' }, { en: 'I take this medicine.' }, { en: 'I have lost my bag.' }, { en: 'Please call the police.' }
    ] },
    { group: 'At the hotel', items: [
      { en: 'We have a reservation.' }, { en: 'Our room key, please.' }, { en: 'What time is breakfast?' },
      { en: 'The room is too cold / too hot.' }
    ] }
  ];
  // Speech codes the phone voices understand (BCP 47). Suggestions only: any code can be typed.
  var SPEECH_CODES = [
    ['pt-PT', 'Portuguese (Portugal)'], ['pt-BR', 'Portuguese (Brazil)'], ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'],
    ['fr-FR', 'French'], ['it-IT', 'Italian'], ['de-DE', 'German'], ['nl-NL', 'Dutch'], ['el-GR', 'Greek'], ['hr-HR', 'Croatian'],
    ['tr-TR', 'Turkish'], ['pl-PL', 'Polish'], ['cs-CZ', 'Czech'], ['hu-HU', 'Hungarian'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'],
    ['sv-SE', 'Swedish'], ['fi-FI', 'Finnish'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['ja-JP', 'Japanese'],
    ['zh-CN', 'Chinese (Mandarin)'], ['th-TH', 'Thai'], ['ar-SA', 'Arabic'], ['ca-ES', 'Catalan'], ['ro-RO', 'Romanian']
  ];
  var TEMPLATE_HINTS = { takeMeTo: 'Please take me to this address:', whereIs: 'Where is {place}?' };
  return { SUGGESTED: SUGGESTED, SPEECH_CODES: SPEECH_CODES, TEMPLATE_HINTS: TEMPLATE_HINTS };
})();
