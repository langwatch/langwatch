import { PaginationFooter } from "../ui/PaginationFooter";

interface EvaluationsPaginationFooterProps {
  totalCount: number;
  pageOffset: number;
  pageSize: number;
  nextPage: () => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
}

export function EvaluationsPaginationFooter({
  totalCount,
  pageOffset,
  pageSize,
  nextPage,
  prevPage,
  changePageSize,
}: EvaluationsPaginationFooterProps) {
  return (
    <PaginationFooter
      totalCount={totalCount}
      pageOffset={pageOffset}
      pageSize={pageSize}
      nextPage={nextPage}
      prevPage={prevPage}
      changePageSize={changePageSize}
      padding={4}
      pageSizeOptions={[10, 25, 50, 100]}
      label="Items per page"
    />
  );
}
