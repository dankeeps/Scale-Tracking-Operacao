import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-[10px] border hairline bg-foreground/[0.03] px-3 py-2 text-sm",
          "transition-[background-color,border-color,box-shadow] duration-150",
          "placeholder:text-muted-foreground/80",
          "hover:bg-foreground/[0.05]",
          "focus-visible:outline-none focus-visible:border-primary/50 focus-visible:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
