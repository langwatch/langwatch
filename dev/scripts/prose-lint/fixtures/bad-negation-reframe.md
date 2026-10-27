We shipped the support bot on a Tuesday, and by Thursday it had told three customers they would get a refund we do not give. I pulled the traces for all three conversations and read the retrieval span first, because the answer text looked confident and the policy page it cited does exist. The span said contexts: [], so the model had answered from its own guess on every one of them.

We fixed the retriever's exception handler, which had been swallowing a timeout and returning an empty list, and the refund answers stopped the same afternoon. It wasn't the model. It was the retrieval.
