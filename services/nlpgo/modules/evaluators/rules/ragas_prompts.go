// Copied from dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §6, which ragas 0.4.3 rendered.

package rules

// Each prompt's head: instruction, output schema and examples, up to the
// input line, byte for byte as ragas 0.4.3's PydanticPrompt.to_string renders it.
const (
	ragasHeadFixOutputFormat = `The output string did not satisfy the constraints given in the prompt. Fix the output string and return it.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"text": {"title": "Text", "type": "string"}}, "required": ["text"], "title": "StringIO", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

-----------------------------

Now perform the same with the following input
`
	ragasHeadStatementGenerator = `Given a question and an answer, analyze the complexity of each sentence in the answer. Break down each sentence into one or more fully understandable statements. Ensure that no pronouns are used in any statement. Format the outputs in JSON.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"statements": {"description": "The generated statements", "items": {"type": "string"}, "title": "Statements", "type": "array"}}, "required": ["statements"], "title": "StatementGeneratorOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "Who was Albert Einstein and what is he best known for?",
    "answer": "He was a German-born theoretical physicist, widely acknowledged to be one of the greatest and most influential physicists of all time. He was best known for developing the theory of relativity, he also made important contributions to the development of the theory of quantum mechanics."
}
Output: {
    "statements": [
        "Albert Einstein was a German-born theoretical physicist.",
        "Albert Einstein is recognized as one of the greatest and most influential physicists of all time.",
        "Albert Einstein was best known for developing the theory of relativity.",
        "Albert Einstein also made important contributions to the development of the theory of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadNLIStatement = `Your task is to judge the faithfulness of a series of statements based on a given context. For each statement you must return verdict as 1 if the statement can be directly inferred based on the context or 0 if the statement can not be directly inferred based on the context.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"$defs": {"StatementFaithfulnessAnswer": {"properties": {"statement": {"description": "the original statement, word-by-word", "title": "Statement", "type": "string"}, "reason": {"description": "the reason of the verdict", "title": "Reason", "type": "string"}, "verdict": {"description": "the verdict(0/1) of the faithfulness.", "title": "Verdict", "type": "integer"}}, "required": ["statement", "reason", "verdict"], "title": "StatementFaithfulnessAnswer", "type": "object"}}, "properties": {"statements": {"items": {"$ref": "#/$defs/StatementFaithfulnessAnswer"}, "title": "Statements", "type": "array"}}, "required": ["statements"], "title": "NLIStatementOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "context": "John is a student at XYZ University. He is pursuing a degree in Computer Science. He is enrolled in several courses this semester, including Data Structures, Algorithms, and Database Management. John is a diligent student and spends a significant amount of time studying and completing assignments. He often stays late in the library to work on his projects.",
    "statements": [
        "John is majoring in Biology.",
        "John is taking a course on Artificial Intelligence.",
        "John is a dedicated student.",
        "John has a part-time job."
    ]
}
Output: {
    "statements": [
        {
            "statement": "John is majoring in Biology.",
            "reason": "John's major is explicitly mentioned as Computer Science. There is no information suggesting he is majoring in Biology.",
            "verdict": 0
        },
        {
            "statement": "John is taking a course on Artificial Intelligence.",
            "reason": "The context mentions the courses John is currently enrolled in, and Artificial Intelligence is not mentioned. Therefore, it cannot be deduced that John is taking a course on AI.",
            "verdict": 0
        },
        {
            "statement": "John is a dedicated student.",
            "reason": "The context states that he spends a significant amount of time studying and completing assignments. Additionally, it mentions that he often stays late in the library to work on his projects, which implies dedication.",
            "verdict": 1
        },
        {
            "statement": "John has a part-time job.",
            "reason": "There is no information given in the context about John having a part-time job.",
            "verdict": 0
        }
    ]
}

Example 2
Input: {
    "context": "Photosynthesis is a process used by plants, algae, and certain bacteria to convert light energy into chemical energy.",
    "statements": [
        "Albert Einstein was a genius."
    ]
}
Output: {
    "statements": [
        {
            "statement": "Albert Einstein was a genius.",
            "reason": "The context and statement are unrelated",
            "verdict": 0
        }
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadClaimDecompositionLowLow = `
    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.
    
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician and philosopher."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German physicist.",
        "Albert Einstein developed relativity and contributed to quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadClaimDecompositionLowHigh = `
    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.
    
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a French mathematician, philosopher, and food critic."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity and also contributed to the development of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadClaimDecompositionHighLow = `
    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.
    
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician.",
        "Charles Babbage was a philosopher."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity."
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadClaimDecompositionHighHigh = `
    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.
    
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician.",
        "Charles Babbage was a philosopher.",
        "Charles Babbage was a food critic.",
        "Charles Babbage was French."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity.",
        "Albert Einstein contributed to the development of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadContextRecall = `Given a context, and an answer, analyze each sentence in the answer and classify if the sentence can be attributed to the given context or not. Use only 'Yes' (1) or 'No' (0) as a binary classification. Output json with reason.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"$defs": {"ContextRecallClassification": {"properties": {"statement": {"title": "Statement", "type": "string"}, "reason": {"title": "Reason", "type": "string"}, "attributed": {"title": "Attributed", "type": "integer"}}, "required": ["statement", "reason", "attributed"], "title": "ContextRecallClassification", "type": "object"}}, "properties": {"classifications": {"items": {"$ref": "#/$defs/ContextRecallClassification"}, "title": "Classifications", "type": "array"}}, "required": ["classifications"], "title": "ContextRecallClassifications", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "What can you tell me about albert Albert Einstein?",
    "context": "Albert Einstein (14 March 1879 - 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass-energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
    "answer": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics. He published 4 papers in 1905. Einstein moved to Switzerland in 1895."
}
Output: {
    "classifications": [
        {
            "statement": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time.",
            "reason": "The date of birth of Einstein is mentioned clearly in the context.",
            "attributed": 1
        },
        {
            "statement": "He received the 1921 Nobel Prize in Physics for his services to theoretical physics.",
            "reason": "The exact sentence is present in the given context.",
            "attributed": 1
        },
        {
            "statement": "He published 4 papers in 1905.",
            "reason": "There is no mention about papers he wrote in the given context.",
            "attributed": 0
        },
        {
            "statement": "Einstein moved to Switzerland in 1895.",
            "reason": "There is no supporting evidence for this in the given context.",
            "attributed": 0
        }
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadContextPrecision = `Given question, answer and context verify if the context was useful in arriving at the given answer. Give verdict as "1" if useful and "0" if not with json output.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"reason": {"description": "Reason for verification", "title": "Reason", "type": "string"}, "verdict": {"description": "Binary (0/1) verdict of verification", "title": "Verdict", "type": "integer"}}, "required": ["reason", "verdict"], "title": "Verification", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "What can you tell me about Albert Einstein?",
    "context": "Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass–energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
    "answer": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics."
}
Output: {
    "reason": "The provided context was indeed useful in arriving at the given answer. The context includes key information about Albert Einstein's life and contributions, which are reflected in the answer.",
    "verdict": 1
}

Example 2
Input: {
    "question": "who won 2020 icc world cup?",
    "context": "The 2022 ICC Men's T20 World Cup, held from October 16 to November 13, 2022, in Australia, was the eighth edition of the tournament. Originally scheduled for 2020, it was postponed due to the COVID-19 pandemic. England emerged victorious, defeating Pakistan by five wickets in the final to clinch their second ICC Men's T20 World Cup title.",
    "answer": "England"
}
Output: {
    "reason": "the context was useful in clarifying the situation regarding the 2020 ICC World Cup and indicating that England was the winner of the tournament that was intended to be held in 2020 but actually took place in 2022.",
    "verdict": 1
}

Example 3
Input: {
    "question": "What is the tallest mountain in the world?",
    "context": "The Andes is the longest continental mountain range in the world, located in South America. It stretches across seven countries and features many of the highest peaks in the Western Hemisphere. The range is known for its diverse ecosystems, including the high-altitude Andean Plateau and the Amazon rainforest.",
    "answer": "Mount Everest."
}
Output: {
    "reason": "the provided context discusses the Andes mountain range, which, while impressive, does not include Mount Everest or directly relate to the question about the world's tallest mountain.",
    "verdict": 0
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadResponseRelevance = `Generate a question for the given answer and Identify if answer is noncommittal. Give noncommittal as 1 if the answer is noncommittal and 0 if the answer is committal. A noncommittal answer is one that is evasive, vague, or ambiguous. For example, "I don't know" or "I'm not sure" are noncommittal answers
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"question": {"title": "Question", "type": "string"}, "noncommittal": {"title": "Noncommittal", "type": "integer"}}, "required": ["question", "noncommittal"], "title": "ResponseRelevanceOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Albert Einstein was born in Germany."
}
Output: {
    "question": "Where was Albert Einstein born?",
    "noncommittal": 0
}

Example 2
Input: {
    "response": "I don't know about the  groundbreaking feature of the smartphone invented in 2023 as am unaware of information beyond 2022. "
}
Output: {
    "question": "What was the groundbreaking feature of the smartphone invented in 2023?",
    "noncommittal": 1
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadExtractKeyphrases = `Extract keyphrases of type: Person, Organization, Location, Date/Time, Monetary Values, and Percentages.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"keyphrases": {"items": {"type": "string"}, "title": "Keyphrases", "type": "array"}}, "required": ["keyphrases"], "title": "ExtractedKeyphrases", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "text": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023."
}
Output: {
    "keyphrases": [
        "Apple Inc.",
        "Cupertino, California",
        "Steve Jobs",
        "1976",
        "$3 trillion",
        "2023"
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadGenerateQuestions = `Based on the given text and keyphrases, generate closed-ended questions that can be answered with '1' if the question can be answered using the text, or '0' if it cannot. The questions should ALWAYS result in a '1' based on the given text.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"questions": {"items": {"type": "string"}, "title": "Questions", "type": "array"}}, "required": ["questions"], "title": "QuestionsGenerated", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "text": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
    "keyphrases": [
        "Apple Inc.",
        "Cupertino, California",
        "Steve Jobs",
        "1976",
        "$3 trillion",
        "2023"
    ]
}
Output: {
    "questions": [
        "Is Apple Inc. a technology company?",
        "Is Apple Inc. based in Cupertino, California?",
        "Was Apple Inc. founded by Steve Jobs?",
        "Was Apple Inc. founded in 1976?",
        "Did Apple Inc. reach a market capitalization of $3 trillion?",
        "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?"
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadGenerateAnswers = `Based on the list of close-ended '1' or '0' questions, generate a JSON with key 'answers', which is a list of strings that determines whether the provided summary contains sufficient information to answer EACH question. Answers should STRICTLY be either '1' or '0'. Answer '0' if the provided summary does not contain enough information to answer the question and answer '1' if the provided summary can answer the question.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"answers": {"items": {"type": "string"}, "title": "Answers", "type": "array"}}, "required": ["answers"], "title": "AnswersGenerated", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "summary": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
    "questions": [
        "Is Apple Inc. a technology company?",
        "Is Apple Inc. based in Cupertino, California?",
        "Was Apple Inc. founded by Steve Jobs?",
        "Was Apple Inc. founded in 1976?",
        "Did Apple Inc. reach a market capitalization of $3 trillion?",
        "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?",
        "Is Apple Inc. a major software company?",
        "Is Apple Inc. known for the iPhone?",
        "Was Steve Jobs the co-founder of Apple Inc.?"
    ]
}
Output: {
    "answers": [
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "0",
        "0",
        "1"
    ]
}
-----------------------------

Now perform the same with the following input
`
	ragasHeadRubrics = `Your task is to assign an appropriate score and provide feedback to the inputs based solely on the scoring criteria passed in the input.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"feedback": {"description": "The feedback for the response", "title": "Feedback", "type": "string"}, "score": {"description": "The score given to the response", "title": "Score", "type": "integer"}}, "required": ["feedback", "score"], "title": "ScoreFeedback", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

-----------------------------

Now perform the same with the following input
`
	ragasHeadSQLEquivalence = `
    Explain and compare two SQL queries (Q1 and Q2) based on the provided database schema. First, explain each query, then determine if they have significant logical differences.
    
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"response_query_explaination": {"description": "Explanation of the generated SQL", "title": "Response Query Explaination", "type": "string"}, "reference_query_explaination": {"description": "Explanation of the reference SQL", "title": "Reference Query Explaination", "type": "string"}, "equivalence": {"description": "Whether the generated SQL is equivalent to the reference SQL", "title": "Equivalence", "type": "boolean"}}, "required": ["response_query_explaination", "reference_query_explaination", "equivalence"], "title": "EquivalenceOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "reference": "SELECT id, name FROM users WHERE active = 1;",
    "response": "SELECT id, name FROM users WHERE active = true;",
    "database_schema": "\n                    Table users:\n                    - id: INT\n                    - name: VARCHAR\n                    - active: BOOLEAN\n                "
}
Output: {
    "response_query_explaination": "The generated SQL query retrieves the id and name of users where the active field is true.",
    "reference_query_explaination": "The reference SQL query retrieves the id and name of users where the active field equals 1.",
    "equivalence": true
}
-----------------------------

Now perform the same with the following input
`
)
