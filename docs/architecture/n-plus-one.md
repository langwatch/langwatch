# N+1 Query Optimization

## Problem

Fetching related data in loops causes N+1 queries:
```typescript
// Bad: N+1 queries
for (const user of users) {
  const posts = await db.post.findMany({ where: { userId: user.id } });
}
```

## Solutions

### 1. Include Relations (Prisma)
```typescript
const users = await db.user.findMany({
  include: { posts: true }
});
```

### 2. Batch Loading
```typescript
const userIds = users.map(u => u.id);
const posts = await db.post.findMany({
  where: { userId: { in: userIds } }
});
const postsByUser = groupBy(posts, 'userId');
```

### 3. DataLoader Pattern
For GraphQL resolvers, use DataLoader to batch and cache.

## Detection

- Enable Prisma query logging in dev
- Watch for repeated similar queries
- Profile slow endpoints
