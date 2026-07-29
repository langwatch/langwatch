#!/usr/bin/env ruby
# Reads a rendered Helm manifest on stdin and emits ONE LINE PER CONTAINER:
#
#   <kind>/<name>|<container>|ro|ape|nonroot|podnonroot|caps|seccomp|automount|resources
#
# where each flag is 1 or 0.
#
# Why this exists. The pod-security assertions used to grep and count strings
# across the whole rendered document. That is unsound for any template with
# more than one pod spec or more than one container: moving a container-level
# field up to the pod level (where Kubernetes ignores it) keeps the totals
# identical, so a suite counting lines reports "read-only root on all 3
# containers" while two of the three actually run writable-root. Fields have to
# be read off the container object they belong to, which needs a parser.
#
# Ruby's YAML (Psych) is stdlib and ships on macOS and the ubuntu-latest
# runners, so this adds no dependency. Init containers are included: admission
# policies evaluate them too.

require "yaml"

# The pod template lives at a different path per workload kind.
def pod_spec(doc)
  return nil unless doc.is_a?(Hash)
  case doc["kind"]
  when "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"
    doc.dig("spec", "template", "spec")
  when "CronJob"
    doc.dig("spec", "jobTemplate", "spec", "template", "spec")
  end
end

# Classic method body, not an endless def: the macOS system Ruby is 2.6.
def flag(value)
  value ? 1 : 0
end

def resources_complete?(container)
  res = container["resources"] || {}
  %w[requests limits].all? do |section|
    %w[cpu memory].all? { |key| !res.dig(section, key).nil? }
  end
end

YAML.load_stream(ARGF.read) do |doc|
  spec = pod_spec(doc)
  next if spec.nil?

  pod_sc = spec["securityContext"] || {}
  seccomp = pod_sc.dig("seccompProfile", "type") == "RuntimeDefault"
  automount = spec["automountServiceAccountToken"] == false
  pod_non_root = pod_sc["runAsNonRoot"] == true
  workload = "#{doc["kind"]}/#{doc.dig("metadata", "name")}"

  (Array(spec["initContainers"]) + Array(spec["containers"])).each do |container|
    sc = container["securityContext"] || {}
    caps = Array(sc.dig("capabilities", "drop")).map(&:to_s).include?("ALL")

    puts [
      workload,
      container["name"],
      flag(sc["readOnlyRootFilesystem"] == true),
      flag(sc["allowPrivilegeEscalation"] == false),
      flag(sc["runAsNonRoot"] == true),
      flag(pod_non_root),
      flag(caps),
      flag(seccomp),
      flag(automount),
      flag(resources_complete?(container)),
    ].join("|")
  end
end
