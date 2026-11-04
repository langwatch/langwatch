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
  it has nothing to normalise or when neither names nor places are being
  redacted, because it costs a second pass on a service that already
  throttles. A level that redacts places but not names still gets the second
  pass, asking for places only. And it may harvest
  person and place spans only: capitals mean something to the code, currency
  and identifier recognisers, and none of them has a casing problem to fix.
  Places are in because the model splits some names across both. In ordinary
  case it reads Maria Fernanda as a person and Costa Pereira as a place, so a
  person-only pass left COSTA PEREIRA in clear. A place is asked for only
  when places are being redacted, and a name only when names are.

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

  Shape alone is not enough. WIDGET PRO has a rewritten word of four letters
  and SEPA ACH has two rewritten words side by side, and both were redacted
  as people. So a span the second pass finds must also hold one name word: a
  word whose ordinary-case form sits at least one and a half times nearer the
  top of the model's frequency-sorted vocabulary than its lowercase and
  capital forms. Frequency falls roughly as one over that position, so this
  is close to one and a half times as frequent. Lee, Whitfield and Okonkwo
  are name words. Widget and Key are written mostly in lowercase, SEPA and API
  mostly in capitals, and Pro only slightly more often in ordinary case. The
  lookup reads the model's frequency table and adds nothing to it.

  The corpus is English, and short names from other traditions are written
  there mostly as something else: Ngo and Seo as acronyms (NGO, SEO), Hung,
  Song and Tan as everyday words. On frequency alone HUNG NGO, WOO SEO and
  CEM TAN stayed in clear while Hung Ngo was redacted, and the rule refused
  up to one capitalised Vietnamese name in eleven. So a bundled list of
  common surnames and given-name syllables from the traditions the corpus
  misreads (Chinese, Korean, Vietnamese, Japanese, Turkish, Arabic, West
  African and South Asian) also counts. English stop words never count from
  it, so AN and DO stay ordinary words. Many listed words are English words
  too (Long, Song, Tan, Bin, Ram, Man), and counting them anywhere redacted
  RAM MODULE and BIN LOCATION as people. So a listed word only counts in a
  span whose every word is listed or unknown to the model: CEM TAN and
  HUNG NGO are kept, RAM MODULE is refused.

  A span of words the corpus holds in no form at all is a rare name, and is
  kept (TAVRIK ZOLNEY). A single unknown word is not enough when the span
  also holds a known word that is not a name word: ZORBEX ULTRA,
  KORVATH EXPRESS and FROSTWYN HOODIE are an invented brand beside an
  ordinary word, and were redacted as people when any unknown word counted.

  The name-word rule has a measured price, and it depends on the naming
  tradition, so it is measured on names the list was not built from. Over 480
  capitalised names from twelve traditions (Vietnamese, Korean, mainland and
  overseas Chinese, Japanese, Turkish, Arabic, Nigerian, Indian, Polish,
  Spanish, Filipino) in three trace sentences, the rule refuses one name,
  KIN FAI HO, whose listed HO sits beside two everyday words. The other 144
  of the 1,440 cases still in clear are ones neither analysis finds, and main
  leaves 1,238 in clear. Over 51,072 pairings of common English forenames and
  surnames, 1.3% are refused, because both words are everyday words as well
  (ROSE WHITE, GRACE BROWN) or the surname is a listed word that is also an
  everyday one (GRACE LONG, ROSE YOUNG). The second pass refuses those, which
  leaves them where they were before it existed. One ordinary-case name word
  is enough, so GRACE NWOSU is still found. A stricter margin of two refuses
  1.6% and buys nothing: WIDGET PRO MAX stays redacted at any margin because
  Max is a name. Over 80 capitalised non-names in two trace sentences, main
  reports 8 of 160 as people or places and the second pass adds 2, both
  VELTRIX MAX. A brand word that is a name word in its own right (NOVA, MAX,
  PHOENIX) is the shape this rule cannot tell from a name.

  Precision is held over capitalised strings that are not people (merchants,
  carriers, departments, SKUs, codes, headings, acronym-heavy prose and
  particle-shaped places and products). Before the second pass existed 37 of
  38 were clean. The first build of the second pass dropped that to 33 of 38,
  because ERP, SOW or CFO turned into Erp, Sow or Cfo and were read as
  surnames, and the shape rule above is what brought it back to 37 of 38. The
  corpus is now 54 strings with two known false positives, named one by one
  in the test: one predates the second pass, and one is a product line named
  after its founder, which has the shape and the words of a name because it
  holds one. A third fails the build. If it does, the second pass is
  inventing people on a shape nobody has priced. Fix the rule. Do not loosen
  the corpus or the list. The same corpus runs with places switched on, and
  the second pass may add no place over it. Five of its strings put a
  non-name where a place would go (moved to API KEY overnight); without the
  name-word rule the second pass reads every one of them as a place.

  Against a rule that demanded every rewritten word be four letters or more,
  the side-by-side clause lifted wholly capitalised names with a short word
  (AMY WHITFIELD, MARCUS LEE, AMY LEE; 24 names) from 5 of 24 to 24 of 24, and
  the particle corpus (24 names per class) from 8.3% to 87.5%, that corpus's
  own control ceiling. It used to cost SEPA ACH in a list of payment rails as
  well; the name-word rule removed that.

  A lowercase name is a different defect and is not in scope here. There is
  no cue in a lowercase word that separates a name from any other word, so
  there is nothing for case normalisation to restore. Lowercase recall is
  pinned at its measured level as a floor, so that it cannot quietly get
  worse, and is tracked separately.

  Rule: Capitals do not hide a name

    @unit
    Scenario: The evaluator redacts a name whose surname is written in capitals
      Given content holding a forename beside a surname written in capitals
      When the content is redacted by the evaluator with person detection on
      Then the redacted content holds neither the forename nor the surname

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
      Given content whose only wholly capitalised words are short
      And no two of them are separated by whitespace alone
      When the content is analysed for personal information
      Then the content is analysed once and not twice

    @unit
    Scenario: The second pass is skipped when every capitalised word is its own field
      Given trace data whose capitalised words are quoted values such as "method": "POST"
      And each is cut off from its neighbours by a quote beside a colon, comma or semicolon
      When the content is analysed for personal information
      Then the content is analysed once and not twice

    @unit
    Scenario: The second pass still runs for a capitalised word that may join another
      Given a capitalised word of four or more letters, or two capitalised words side by side
      And a neighbouring word joined to it by a space, comma, colon, quote, bracket, apostrophe or dash
      And no quote beside a colon, comma or semicolon between them
      When the content is analysed for personal information
      Then the content is analysed twice

    @unit
    Scenario: The second pass also looks for places when places are redacted
      Given content carrying a wholly capitalised name
      And person and location detection are both switched on
      When the content is analysed for personal information
      Then the second analysis asks for persons and places

    @unit
    Scenario: The second pass is skipped when neither names nor places are redacted
      Given content carrying a wholly capitalised word
      And person and location detection are both switched off
      When the content is analysed for personal information
      Then the content is analysed once and not twice

    @unit
    Scenario: The second pass asks only for places when only places are redacted
      Given content carrying a wholly capitalised name
      And location detection is on and person detection is off
      When the content is analysed for personal information
      Then the second analysis asks for places and not for persons

  Rule: The second pass changes nothing but name and place spans

    @unit
    Scenario: Only name and place spans come out of the second pass
      Given content holding a name only the second pass finds
      And an email address, a bank account and a card number in capitals
      When the content is analysed for personal information
      Then the name is reported as a person
      And every span that is not a person or a place is reported exactly as the first pass found it
      And a span of another kind the second analysis returns is not reported

    @unit
    Scenario: A surname the model reads as a place is still redacted in capitals
      Given a name whose two-word surname the model reads as a place in ordinary case
      And the surname is written wholly in capitals
      And person and location detection are both switched on
      When the content is analysed for personal information
      Then the surname is reported as it is in ordinary case

  Rule: A name is not read into a string that is not one

    @unit
    Scenario: An ALL-CAPS string that is not a name is not read as a person
      Given capitalised merchant, carrier, department, product, code and heading strings
      When the content is analysed for personal information
      Then no person span is reported over any of them

    @unit
    Scenario: The second pass adds no place over an ALL-CAPS string that is not one
      Given capitalised non-names, five of them standing where a place would go
      And person and location detection are both switched on
      When the content is analysed for personal information
      Then each of those five is analysed a second time
      And the second analysis adds no place span over any of them

    @unit
    Scenario: A titlecased acronym is not harvested as a name
      Given prose in which a three-letter acronym stands alone in capitals
      When the content is analysed for personal information
      Then no person span is reported

    @unit
    Scenario: Capitalised words that are not name words are not harvested
      Given a product word, a pair of acronyms or an acronym beside an everyday word, in capitals
      When the content is analysed for personal information
      Then no person or place span is reported over it

    @unit
    Scenario: A name made only of everyday words is not harvested in capitals
      Given a name written wholly in capitals whose every word is also an everyday word
      When the content is analysed for personal information
      Then no person span is reported, as before the second pass existed
      And a name the first pass misses, with one name word beside an everyday word, is still reported

    @unit
    Scenario: A short name the corpus mostly writes as another word is still harvested
      Given a short name written wholly in capitals whose words the corpus writes mostly as acronyms or everyday words
      When the content is analysed for personal information
      Then the whole name is reported as a person

    @unit
    Scenario: A listed name that is also an everyday word does not make a name of everyday words
      Given a listed name word that is also an everyday word, beside another everyday word, in capitals
      When the content is analysed for personal information
      Then no person span is reported over it
      And a short name of listed words only is still reported

    @unit
    Scenario: An unknown word beside an everyday word is not harvested
      Given an invented brand name beside an everyday word, in capitals
      When the content is analysed for personal information
      Then no person or place span is reported over it

    @unit
    Scenario: A name of words the model has never seen is still harvested
      Given a name written wholly in capitals whose every word is unknown to the model
      When the content is analysed for personal information
      Then the whole name is reported as a person

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
