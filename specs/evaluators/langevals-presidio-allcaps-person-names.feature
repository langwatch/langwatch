Feature: A name written in capitals is still redacted

  Redaction asks the PII evaluator which spans of a trace are a person's
  name, and hides what it is told. A span it does not report is stored and
  shown in full, so a miss here is a disclosure and it is not recoverable
  after the fact.

  The detector reads capitalisation as evidence. A name written the ordinary
  way is found almost every time; the same name with the surname in capitals
  is found less often, and the same name wholly in capitals is missed most of
  the time. Capitals are not an unusual way to write a name in a trace: forms
  shout, legacy systems upper-case their columns, and logistics and banking
  payloads carry names in capitals as a matter of course. The miss is not a
  low confidence score to be tuned past, it is no span at all.

  So the content is analysed a second time over a copy with every wholly
  capitalised word written in ordinary case, and the person spans that copy
  reveals are added to the ones already found. The copy is built character
  for character, so every offset still indexes the original text and there is
  no mapping table to get wrong.

  Three things bound it. The copy may never change length, because the
  offsets are used against the original. The second analysis may not run when
  it has nothing to normalise or when person detection is off, because it
  costs a second pass on a service that already throttles. And it may harvest
  person spans only: capitals mean something to the code, currency and
  identifier recognisers, and none of them has a casing problem to fix.

  Titlecasing restores the name cue on WHITFIELD and invents the same cue on
  CEO, so a span the second pass finds is kept only if it has the shape of a
  name: two or more words, and either a rewritten word of four or more
  letters or two rewritten words side by side. The second clause is what
  keeps AMY LEE, VAN DER BERG and BIN RASHID. A short capitalised word on its
  own (the CFO, the ROI) is the acronym shape and is refused. Requiring two
  long rewritten words looks safer and is not: it throws an ordinary forename
  beside a capitalised surname back to where it started. A capitalised
  surname standing alone (OKONKWO) is one word, the same shape as an
  acronym, and is refused on purpose. The second pass does not run when the
  text holds neither shape, so OK, ID or USD scattered through prose cost
  nothing.

  Precision is held over capitalised strings that are not people (merchants,
  carriers, departments, SKUs, codes, headings, acronym-heavy prose and
  particle-shaped places and products). Before the second pass existed 37 of
  38 were clean. The first build of the second pass dropped that to 33 of 38,
  because ERP, SOW or CFO turned into Erp, Sow or Cfo and were read as
  surnames, and the shape rule above is what brought it back to 37 of 38. The
  corpus is now 46 strings with three known false positives, named one by one
  in the test: one predates the second pass, and two are the price of the
  side-by-side clause, described next. A fourth fails the build. If it does,
  the second pass is inventing people on a shape nobody has priced. Fix the
  rule. Do not loosen the corpus or the list.

  Against a rule that demanded every rewritten word be four letters or more,
  the side-by-side clause lifted wholly capitalised names with a short word
  (AMY WHITFIELD, MARCUS LEE, AMY LEE; 24 names) from 5 of 24 to 24 of 24, and
  the particle corpus (24 names per class) from 8.3% to 87.5%, that corpus's
  own control ceiling. It costs two false positives: a product line named
  after its founder, and SEPA ACH in a list of payment rails. The first
  cannot be removed, since such a name has the shape of a name because it is
  one. Both are accepted because the alternative leaks short and particle
  names, so whether a name is protected would depend on how long it is.

  A lowercase name is a different defect and is not in scope here. There is
  no cue in a lowercase word that separates a name from any other word, so
  there is nothing for case normalisation to restore. Lowercase recall is
  pinned at its measured level as a floor, so that it cannot quietly get
  worse, and is tracked separately.

  Rule: Capitals do not hide a name

    @unit
    Scenario: An ordinarily capitalised name is still detected
      Given names written the ordinary way in a trace payload
      When the content is analysed for personal information
      Then the person spans are reported as reliably as they always were

    @unit
    Scenario: A capitalised surname is detected as reliably as an ordinary one
      Given names whose surname is written wholly in capitals
      When the content is analysed for personal information
      Then the person spans are reported as often as for ordinary capitalisation

    @unit
    Scenario: A wholly capitalised name is detected as reliably as an ordinary one
      Given names written wholly in capitals
      When the content is analysed for personal information
      Then the person spans are reported as often as for ordinary capitalisation

    @unit
    Scenario: A lowercase name is held at its measured floor, not raised
      Given names written wholly in lowercase
      When the content is analysed for personal information
      Then the person spans are reported at least as often as they were before

  Rule: The copy the second pass reads lines up with the original

    @unit
    Scenario: Case normalisation never changes the length of the text
      Given text holding a capital whose lowercase form is longer than itself
      When the text is normalised for a second analysis
      Then the normalised text is exactly as long as the original
      And the character that could not be lowered safely is left as it was

  Rule: The second pass runs only when it can help

    @unit
    Scenario: The second pass is skipped when it has nothing to normalise
      Given content carrying no wholly capitalised word
      When the content is analysed for personal information
      Then the content is analysed once and not twice

    @unit
    Scenario: The second pass is skipped when the only capitals are short words
      Given content whose only wholly capitalised words are short and stand apart
      When the content is analysed for personal information
      Then the content is analysed once and not twice

    @unit
    Scenario: The second pass is skipped when person detection is off
      Given content carrying a wholly capitalised word
      And person detection is switched off
      When the content is analysed for personal information
      Then the content is analysed once and not twice

  Rule: The second pass changes nothing but person spans

    @unit
    Scenario: Only person spans come out of the second pass
      Given content holding a name only the second pass finds
      And an email address, a bank account and a card number in capitals
      When the content is analysed for personal information
      Then the name is reported as a person
      And every span that is not a person is reported exactly as the first pass found it

  Rule: A name is not read into a string that is not one

    @unit
    Scenario: An ALL-CAPS string that is not a name is not read as a person
      Given capitalised merchant, carrier, department, product, code and heading strings
      When the content is analysed for personal information
      Then no person span is reported over any of them

    @unit
    Scenario: A titlecased acronym is not harvested as a name
      Given prose in which a three-letter acronym stands alone in capitals
      When the content is analysed for personal information
      Then no person span is reported

    @unit
    Scenario: A name with one capitalised word is still harvested
      Given a name written as an ordinary forename beside a wholly capitalised surname
      When the content is analysed for personal information
      Then the whole name is reported as a person

    @unit
    Scenario: A capitalised name with a surname particle is still harvested
      Given a name written wholly in capitals whose surname carries a particle
      When the content is analysed for personal information
      Then the whole name is reported as a person

    @unit
    Scenario: A capitalised name made of short words is still harvested
      Given a name written wholly in capitals whose forename and surname are under four letters
      When the content is analysed for personal information
      Then the whole name is reported as a person

  Rule: One person is counted once

    @unit
    Scenario: One name is counted once, at its widest span
      Given a name the first pass reads as a forename alone
      When the content is analysed for personal information
      Then the name is reported once, over the whole of it
