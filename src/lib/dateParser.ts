/**
 * Natural language date/time parser for South African locale.
 * Handles: "tomorrow at 2pm", "Monday 10am", "next Friday 14:30", "25 June 9am"
 */

export function parseNaturalDatetime(input: string, _timezone: string = 'Africa/Johannesburg'): Date {
  const now = new Date();
  const text = input.toLowerCase().trim();

  // Extract time
  let hours = 9; // default 9am
  let minutes = 0;

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }

  // Determine date
  let targetDate = new Date(now);

  if (text.includes('tomorrow')) {
    targetDate.setDate(now.getDate() + 1);
  } else if (text.includes('today')) {
    // same day
  } else if (text.includes('next week')) {
    targetDate.setDate(now.getDate() + 7);
  } else {
    // Check for day of week
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayMatch = days.findIndex((d) => text.includes(d));

    if (dayMatch !== -1) {
      const todayDay = now.getDay();
      let daysAhead = dayMatch - todayDay;
      if (daysAhead <= 0) daysAhead += 7; // next occurrence
      targetDate.setDate(now.getDate() + daysAhead);
    } else {
      // Check for date like "25 June" or "June 25"
      const months = [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
      ];
      const monthMatch = months.findIndex((m) => text.includes(m));
      const dayNumMatch = text.match(/\b(\d{1,2})\b/);

      if (monthMatch !== -1 && dayNumMatch) {
        const dayNum = parseInt(dayNumMatch[1]);
        targetDate = new Date(now.getFullYear(), monthMatch, dayNum);
        // If date has passed, assume next year
        if (targetDate < now) {
          targetDate.setFullYear(now.getFullYear() + 1);
        }
      } else {
        // Default to tomorrow if nothing matched
        targetDate.setDate(now.getDate() + 1);
      }
    }
  }

  targetDate.setHours(hours, minutes, 0, 0);
  return targetDate;
}
