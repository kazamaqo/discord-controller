import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useConnectBot } from "@workspace/api-client-react";

const loginSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const connectBot = useConnectBot();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { token: "" },
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    connectBot.mutate(
      { data: { token: values.token } },
      {
        onSuccess: () => {
          setLocation("/dashboard");
        },
        onError: () => {
          toast({ title: "Invalid token", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-red-500 text-center font-bold text-xl tracking-widest uppercase">
          PUT UR TOKEN HERE
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="token..."
                      className="bg-[#0a0a0a] border-[#222] text-white font-mono h-12 focus-visible:ring-red-500"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-red-500 text-xs" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-widest"
              disabled={connectBot.isPending}
            >
              {connectBot.isPending ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
